import type { MenuItem, NativeQuestion, RemovalQuestion, RemovalAnswer } from "../app/seam";

/** The last system menu a test seam showed, and how to answer it; every test seam writes it. */
type Probe = { shown: MenuItem[] | null; answer: ((id: string | null) => void) | null; count: number };

export const menuProbe: Probe = { shown: null, answer: null, count: 0 };

/** A test seam's `showContextMenu`: records the menu and waits for `answer`. */
export const probeMenu = (items: MenuItem[]): Promise<string | null> => new Promise((resolve) => {
  menuProbe.shown = items;
  menuProbe.count += 1;
  menuProbe.answer = resolve;
});

type ProjectMenuProbe = { path: string | null; items: MenuItem[] };

export const projectMenu: ProjectMenuProbe = { path: null, items: [] };

/** Deliver the native host's captured Project command through the fake App seam. */
export const openProjectPage = (command: string, path: string | null = document.querySelector(".project-tab") ? projectMenu.path : "/p") => {
  if (path === null) return;

  window.dispatchEvent(new CustomEvent("open-project-page", { detail: { path, command } }));
};

/** Native questions have no web DOM. The isolated harness observes and answers this boundary. */
type QuestionProbe = { shown: NativeQuestion | RemovalQuestion | null; answer: ((accepted: boolean | RemovalAnswer) => void) | null; count: number };

export const questionProbe: QuestionProbe = { shown: null, answer: null, count: 0 };

export const probeQuestion = (question: NativeQuestion): Promise<boolean> => new Promise(resolve => {
  questionProbe.shown = question;
  questionProbe.count++;
  questionProbe.answer = accepted => { questionProbe.shown = null; questionProbe.answer = null; resolve(accepted === true); };
});

/** The harness delivers a native button choice without drawing a web dialog. */
export const probeRemovalQuestion = (question: RemovalQuestion): Promise<RemovalAnswer> => new Promise(resolve => {
  questionProbe.shown = question;
  questionProbe.count++;
  questionProbe.answer = answer => {
    questionProbe.shown = null;
    questionProbe.answer = null;
    resolve(answer === true ? "this" : answer === false ? "cancel" : answer);
  };
});

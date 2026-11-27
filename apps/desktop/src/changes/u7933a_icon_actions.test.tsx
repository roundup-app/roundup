import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { storageIdle } from "../state/storage";
import { chooseIconNames } from "../ui/Tip";
import { copy } from "./copy";
import type { Note } from "./notes";
import type { Line } from "./callPaths";
import type { CallPathsState } from "./callPaths";
import { NoteView } from "./NoteView";
import type { RemoteChip as Chip } from "./remote";
import { RemoteChip } from "./RemoteChip";
import { RepeatStates } from "./RepeatStates";
import { TraceLine } from "./FlowStates";
import { openBatch, openDiff, saveNote } from "./noteHarness";
import { drawn, file, multi, open } from "./viewHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const chip = (kind: "moved" | "failed"): Chip => kind === "moved" ? { kind } : { kind, cause: "x" };

const line = (state: Line["state"], action: Line["action"]): Line => ({ language: "typescript", files: 2, state, cause: "boom", action });

// SAFETY: a trace line calls only `trace`.
const calls: CallPathsState = Object.assign(Object.create(null), { trace: () => {} });

// SAFETY: the repeat states read only `scanning`, `failed`, `partial` and `again`.
const scan: Parameters<typeof RepeatStates>[0]["scan"] = Object.assign(Object.create(null), { scanning: () => false, failed: () => "boom", partial: () => false, again: () => {} });

const longNote: Note = { id: 1, revision: "r", item: { kind: "file", name: "a.ts", title: "a.ts", blobs: {} }, text: Array.from({ length: 8 }, (_, index) => `line ${index}`).join("\n") };

/** The open file's disk copy changes under it: the view offers Reload. */
const updatedFile = async () => {
  let blob = "one";
  const { connected } = await open(() => ({ files: [{ ...file("a.ts"), blob }] }), path => multi(path, blob));

  await drawn();
  blob = "two";
  await connected.owned.refresh("a");
  await screen.findByText(copy.updatedFile("a"));
};

/** A send the Agent never answers: the note stays unknown, with Check Message history on the bar. */
const unknownSend = async () => {
  const mounted = await openDiff();

  await saveNote("tidy");
  mounted.app.handlers["message.send"] = () => { throw new Error("disconnected"); };

  fireEvent.click(screen.getByRole("button", { name: copy.sendNotesTo("a") }));
  await screen.findByRole("button", { name: copy.checkMessageHistory });

  return mounted;
};

type State = { make: () => void | Promise<void>; scope?: () => HTMLElement; names: string[] };

const states: State[] = [
  { make: () => { render(() => <RemoteChip chip={chip("moved")} fetch={() => {}} retry={() => {}} />); }, names: [copy.fetch] },
  { make: () => { render(() => <RemoteChip chip={chip("failed")} fetch={() => {}} retry={() => {}} />); }, names: [copy.retry] },
  { make: () => { render(() => <TraceLine line={line("untraced", "trace")} calls={calls} />); }, names: [copy.trace] },
  { make: () => { render(() => <TraceLine line={line("failed", "retry")} calls={calls} />); }, names: [copy.retry] },
  { make: () => { render(() => <RepeatStates scan={scan} notAsked={false} />); }, names: [copy.retry] },
  { make: () => { render(() => <NoteView note={longNote} status="unsent" edit={() => {}} remove={() => {}} />); screen.getByRole("article").focus(); }, names: [copy.showAll] },
  { make: () => { render(() => <NoteView note={longNote} status="unsent" edit={() => {}} remove={() => {}} />); screen.getByRole("article").focus(); }, names: [copy.editTip] },
  { make: () => { render(() => <NoteView note={longNote} status="unsent" edit={() => {}} remove={() => {}} />); screen.getByRole("article").focus(); }, names: [copy.removeTip] },
  { make: async () => { await openDiff(); await saveNote("tidy"); await openBatch(); }, names: [copy.closeChanges, copy.editNote(1), copy.removeNote(1), copy.sendNotesTo("a")] },
  { make: async () => {
    await openDiff();
    await saveNote("tidy");
    fireEvent.click(screen.getByRole("button", { name: copy.removeNote(1) }));
    await screen.findByText(copy.noteRemoved);
  }, names: [copy.undo] },
  { make: async () => { await unknownSend(); }, names: [copy.checkMessageHistory, copy.recoverNotes] },
  { make: async () => {
    const first = await openDiff();

    await saveNote("tidy");
    first.view.unmount();
    cleanup();
    await openDiff();
    await screen.findByText(copy.notesKept(1));
  }, names: [copy.dismissLine] },
  { make: updatedFile, names: [copy.reload] },
  { make: async () => {
    const { connected } = await unknownSend();

    connected.showView("notes");
    await screen.findByRole("dialog", { name: copy.recoverNotes });
  }, scope: () => screen.getByRole("dialog", { name: copy.recoverNotes }), names: [copy.close, copy.checkMessageHistory, copy.discardSubmission] },
];

const eachAction = async (check: (button: HTMLElement, name: string) => void | Promise<void>) => {
  for (const state of states) {
    await state.make();

    for (const name of state.names) await check(within(state.scope?.() ?? document.body).getByRole("button", { name }), name);
    cleanup();
    await storageIdle();
    localStorage.clear();
  }
};

it("u7933a_no_action_button_shows_text", async () => {
  await eachAction(button => {
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg.icon")).not.toBeNull();
  });
});

it("u7933a_each_icon_button_keeps_its_name", async () => {
  await chooseIconNames("always");
  await eachAction(async (button, name) => {
    fireEvent.keyDown(document, { key: "Tab" });
    button.focus();

    await waitFor(() => expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).toBe(name));
    button.blur();
  });
});

it("u7933a_status_lines_stay_words", async () => {
  await updatedFile();
  render(() => <TraceLine line={line("failed", "retry")} calls={calls} />);
  render(() => <RemoteChip chip={chip("moved")} fetch={() => {}} retry={() => {}} />);
  render(() => <RemoteChip chip={{ kind: "fetched", commits: 2 }} fetch={() => {}} retry={() => {}} />);
  expect(screen.getByText(copy.updatedFile("a"))).toBeTruthy();
  expect(screen.getByText(copy.traceFailed("TypeScript"))).toBeTruthy();
  expect(screen.getByText(copy.remoteMoved)).toBeTruthy();
  expect(screen.getByText(copy.fetched(2))).toBeTruthy();
});

import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { Sent } from "@contracts/feedback/Sent";
import type { Candidate } from "../toasts/queue";
import { saveAppSettings } from "../settings/preferences";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import type { FeedbackReport } from "../app/seam";
import { Feedback } from "./Feedback";
import { FeedbackSetting } from "./FeedbackSetting";
import { validIssueUrl } from "./target";

const URL = "https://github.com/roundup-app/roundup/issues/6163";

const report = (shot: string | null = "iVBOR", shot_error: string | null = null): FeedbackReport => ({ shot, shot_error, facts: { version: "1.2.3", commit: "abc", macos: "15.1", log: ["line one"] } });

afterEach(async () => { cleanup(); await saveAppSettings({ feedbackIssue: "" }); localStorage.clear(); });

const mount = async (capture: () => Promise<FeedbackReport> = async () => report()) => {
  const app = createFakeApp();
  const sends: unknown[] = [];
  const ids: string[] = [];
  const toasts: Candidate[] = [];
  let sent: () => Promise<Sent> = async () => ({ state: "posted", url: `${URL}#issuecomment-1` });

  app.handlers["rail.tree"] = () => [agent("ann", "working", "busy", { name: "Ann" })];
  app.handlers["feedback.send"] = (params) => {
    sends.push(params);
    ids.push(params.id);

    return sent();
  };

  app.handlers["feedback.retry"] = (params) => {
    sends.push(params);
    ids.push(params.id);

    return sent();
  };

  app.feedbackCapture = vi.fn(capture);

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

  connected.rail.select("ann");
  render(() => <ConnectedProjectContext.Provider value={connected}><Feedback notify={candidate => toasts.push(candidate)} /></ConnectedProjectContext.Provider>);
  await connected.rail.settled();

  return { app, sends, ids, toasts, answer: (next: () => Promise<Sent>) => { sent = next; } };
};

const chord = (target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "F", code: "KeyF", metaKey: true, shiftKey: true, bubbles: true, cancelable: true, ...init }));

const field = () => document.querySelector<HTMLTextAreaElement>(".feedback-form textarea");

const form = () => document.querySelector(".feedback-form");

const send = () => fireEvent.click(document.querySelector<HTMLButtonElement>('.feedback-form button[type="submit"]')!);

const open = async () => { chord(); await waitFor(() => expect(document.activeElement).toBe(field())); };

it("fb1_the_chord_opens_the_form_with_focus_in_the_field", async () => {
  const { app } = await mount();

  await open();
  chord(field()!);
  expect(app.feedbackCapture).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll(".feedback-form")).toHaveLength(1);
});

it("fb1_a_focused_terminal_does_not_receive_the_chord", async () => {
  await mount();
  const terminal = document.body.appendChild(document.createElement("textarea"));
  const reached: string[] = [];

  terminal.className = "xterm-helper-textarea";
  terminal.addEventListener("keydown", event => reached.push(event.code));
  terminal.focus();
  expect(chord(terminal)).toBe(false);
  await waitFor(() => expect(form()).not.toBeNull());
  expect(reached).toEqual([]);
});

it("fb1_escape_closes_and_restores_focus", async () => {
  await mount();
  const before = document.body.appendChild(document.createElement("button"));

  before.focus();
  chord(before);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.keyDown(field()!, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(form()).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(before));
});

it("fb1_the_shot_is_requested_before_the_form_mounts", async () => {
  let resolve!: (value: FeedbackReport) => void;
  const { app } = await mount(() => new Promise(done => { resolve = done; }));

  chord();
  expect(app.feedbackCapture).toHaveBeenCalledTimes(1);
  expect(form()).toBeNull();
  resolve(report());
  await waitFor(() => expect(form()).not.toBeNull());
});

it("fb2_a_failed_capture_opens_the_form_without_a_shot", async () => {
  const { sends } = await mount(async () => report(null, "refused"));

  await open();
  expect(document.querySelector(".feedback-shot")).toBeNull();
  send();
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).not.toHaveProperty("shot");
});

it("fb2_the_form_previews_the_shot_and_drops_it", async () => {
  await mount();
  await open();
  expect(document.querySelector<HTMLImageElement>(".feedback-shot img")!.src).toContain("iVBOR");
  fireEvent.click(document.querySelector(".feedback-shot button")!);
  expect(document.querySelector(".feedback-shot")).toBeNull();
});

it("fb2_a_dropped_shot_is_not_sent", async () => {
  const { sends } = await mount();

  await open();
  fireEvent.click(document.querySelector(".feedback-shot button")!);
  send();
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).not.toHaveProperty("shot");
});

it("fb3_the_form_shows_the_text_that_posts", async () => {
  const { sends } = await mount();

  await open();
  fireEvent.input(field()!, { target: { value: "the Rail jumps" } });

  const shown = document.querySelector(".feedback-facts")!.textContent;

  send();
  await waitFor(() => expect(sends).toHaveLength(1));
  expect(sends[0]).toMatchObject({ text: "the Rail jumps", facts: shown, shot: "iVBOR", selected: "ann" });
});

it("fb4_send_closes_the_form_and_the_toast_links_the_comment", async () => {
  await saveAppSettings({ feedbackIssue: URL });
  const { app, sends, toasts } = await mount();

  await open();
  send();
  await waitFor(() => expect(form()).toBeNull());
  await waitFor(() => expect(toasts).toHaveLength(1));
  expect(sends[0]).toMatchObject({ target: URL });
  await expect(toasts[0]!.open("pointer")).resolves.toBeNull();
  expect(app.openedTargets).toEqual([{ kind: "url", url: `${URL}#issuecomment-1` }]);
});

it("fb4_the_app_stays_usable_while_it_posts", async () => {
  const { answer, toasts } = await mount();
  let finish!: (sent: Sent) => void;

  answer(() => new Promise(done => { finish = done; }));
  await open();
  send();
  await waitFor(() => expect(form()).toBeNull());
  expect(toasts).toHaveLength(0);
  chord();
  await waitFor(() => expect(form()).not.toBeNull());
  finish({ state: "posted", url: URL });
  await waitFor(() => expect(toasts).toHaveLength(1));
});

it("fb5_the_toast_names_the_cause_and_the_folder_and_retries", async () => {
  const { answer, sends, ids, toasts } = await mount();

  answer(async () => ({ state: "kept", dir: "/data/feedback/r1", cause: "gh: not logged in" }));
  await open();
  send();
  await waitFor(() => expect(toasts).toHaveLength(1));
  expect(toasts[0]!.name).toContain("gh: not logged in");
  expect(toasts[0]!.line).toContain("/data/feedback/r1");
  answer(async () => ({ state: "posted", url: URL }));
  await expect(toasts[0]!.open("pointer")).resolves.toBeNull();
  expect(sends[1]).toMatchObject({ id: ids[0] });
  expect(toasts).toHaveLength(2);
});

it("fb6_the_setting_holds_and_validates_the_issue_url", async () => {
  const failures: (string | null)[] = [];
  const view = render(() => <FeedbackSetting onFailure={failure => failures.push(failure)} />);
  const input = view.container.querySelector("input")!;

  fireEvent.input(input, { target: { value: "not a url" } });
  fireEvent.blur(input);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(validIssueUrl(URL)).toBe(true);
  expect(validIssueUrl("https://github.com/o/r/pull/3")).toBe(false);
  fireEvent.input(input, { target: { value: URL } });
  fireEvent.blur(input);
  await waitFor(() => expect(failures).toEqual([null]));
  expect((await import("../settings/preferences")).appSettings().feedbackIssue).toBe(URL);
});

it("fb6_an_empty_setting_keeps_the_report_and_says_so", async () => {
  const { answer, sends, toasts } = await mount();

  answer(async () => ({ state: "kept", dir: "/d/r1", cause: "the Feedback Issue setting is empty" }));
  await open();
  send();
  await waitFor(() => expect(toasts).toHaveLength(1));
  expect(sends[0]).toMatchObject({ target: "" });
  expect(toasts[0]!.name).toContain("setting is empty");
});

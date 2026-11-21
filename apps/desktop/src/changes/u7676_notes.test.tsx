import { notesFor } from "./notes";
import { copy } from "./copy";
import { RpcError } from "../app/seam";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { message } from "../testing/centreFixture";
import { COMPARISON, noteList, openBatch, openDiff, openFile, saveNote, startNote, treeRow } from "./noteHarness";
import { afterEach, expect, it, vi } from "vitest";
import { VirtualizedFileDiff } from "@pierre/diffs";
import { storageIdle } from "../state/storage";

// ESM exports are non-configurable: spy mode records the scenario's library calls while executing the real implementation.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@pierre/diffs", { spy: true });

afterEach(async () => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); await storageIdle(); localStorage.clear(); });

const present = <T,>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Expected a value");

  return value;
};

const options = () => present(present(vi.mocked(VirtualizedFileDiff).mock.calls.at(-1))[0]);

const diffContent = () => present(document.querySelector(".diff-content"));

const batch = () => present(noteList());

/** The lines Pierre marks as selected, as "<type>:<number>". */
const selectedLines = () => [...diffContent().querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line][data-selected-line]") ?? []].map(line => `${line.getAttribute("data-line-type")}:${line.getAttribute("data-line")}`);

const firstNote = (app: Parameters<typeof notesFor>[0]) => present(notesFor(app, "/p").list("a")[0]);

const form = () => within(screen.getByRole("form", { name: copy.lineNote }));

const field = () => form().getByLabelText<HTMLTextAreaElement>(copy.note);

const press = (key: string, target: Element = diffContent()) => { fireEvent.keyDown(target, { key }); };

const bar = () => screen.getByLabelText(copy.notesRegion, { selector: "section" });

const sendButton = () => within(bar()).getByRole("button", { name: /Send notes:|Retry/ });

// SAFETY: both fields are number inputs, so each element is an HTMLInputElement.
const range = () => [form().getByRole("spinbutton", { name: "Start line" }), form().getByRole("spinbutton", { name: "End line" })].map(input => (input as HTMLInputElement).value);

it("u7676a_the_gutter_plus_opens_the_field_for_that_line", async () => {
  await openDiff();
  expect(options().enableGutterUtility).toBe(true);
  present(options().onGutterUtilityClick)({ side: "additions", start: 2, end: 2 });
  await screen.findByRole("form", { name: copy.lineNote });
  expect(range()).toEqual(["2", "2"]);
  expect(form().getByRole("tab", { name: "New" }).getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(document.activeElement).toBe(field()));
});

it("u7676a_a_drag_over_line_numbers_opens_the_field_for_the_range", async () => {
  await openDiff();
  present(options().onLineSelectionEnd)({ side: "deletions", start: 2, end: 1 });
  await screen.findByRole("form", { name: copy.lineNote });
  expect(range()).toEqual(["1", "2"]);
  expect(form().getByRole("tab", { name: "Old" }).getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(selectedLines()).toEqual(["change-deletion:1", "change-deletion:2"]));
});

it("u7676a_add_note_and_new_line_are_gone_and_the_notices_stay", async () => {
  await openDiff();
  expect(screen.queryByRole("button", { name: /^Add note/ })).toBeNull();
  expect(screen.queryByText(/^New line \d/)).toBeNull();
});

it("u7676b_n_opens_the_labelled_field_preset_from_the_line_or_range", async () => {
  await openDiff();
  present(options().onLineNumberClick)({ type: "diff-line", lineType: "change-addition", lineElement: document.createElement("div"), numberElement: document.createElement("span"), numberColumn: true, lineNumber: 2, annotationSide: "additions", event: new PointerEvent("click") });
  press("n");
  await screen.findByRole("form", { name: copy.lineNote });
  expect(range()).toEqual(["2", "2"]);
  expect(form().getAllByRole("tab").length).toBe(2);
  fireEvent.keyDown(field(), { key: "Escape" });
  present(options().onLineNumberClick)({ type: "diff-line", lineType: "change-addition", lineElement: document.createElement("div"), numberElement: document.createElement("span"), numberColumn: true, lineNumber: 1, annotationSide: "additions", event: new PointerEvent("click", { shiftKey: true }) });
  press("n");
  await screen.findByRole("form", { name: copy.lineNote });
  expect(range()).toEqual(["1", "2"]);
});

it("u7676b_cmd_enter_saves_and_escape_keeps_text_as_unfinished_work", async () => {
  const { app } = await openDiff();
  startNote();
  fireEvent.input(field(), { target: { value: "typed" } });
  fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
  await waitFor(() => expect(notesFor(app, "/p").list("a").map(note => note.text)).toEqual(["typed"]));
  await waitFor(() => expect(screen.queryByRole("form", { name: copy.lineNote })).toBeNull());
  expect(document.activeElement).toBe(document.querySelector(".diff-content"));
  startNote();
  fireEvent.keyDown(field(), { key: "Escape" });
  expect(screen.queryByRole("form", { name: copy.lineNote })).toBeNull();
  expect(notesFor(app, "/p").unfinished("a")).toEqual([]);
  startNote();
  fireEvent.input(field(), { target: { value: "half" } });
  fireEvent.keyDown(field(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("form", { name: copy.lineNote })).toBeNull());
  expect(notesFor(app, "/p").unfinished("a").map(draft => draft.text)).toEqual(["half"]);
  expect(document.activeElement).toBe(document.querySelector(".diff-content"));
  startNote();
  expect(field().value).toBe("half");
});

it("u7676b_e_edits_and_delete_removes_the_notes_line", async () => {
  const { app } = await openDiff();
  await saveNote("kept");
  press("e");
  expect(field().value).toBe("kept");
  fireEvent.keyDown(field(), { key: "Escape" });
  press("Delete");
  await waitFor(() => expect(notesFor(app, "/p").list("a")).toEqual([]));
  await screen.findByText(copy.noteRemoved);
  fireEvent.click(screen.getByRole("button", { name: copy.undo }));
  await waitFor(() => expect(notesFor(app, "/p").list("a")).toHaveLength(1));
  press("Backspace");
  await waitFor(() => expect(notesFor(app, "/p").list("a")).toEqual([]));
});

it("u7676b_the_keys_list_gains_n_e_and_delete", async () => {
  await openDiff();
  press("?");
  const keys = await screen.findByRole("region", { name: copy.keys });
  const items = within(keys).getAllByRole("listitem").map(item => item.textContent ?? "");

  expect(items.some(item => /^N\b/.test(item))).toBe(true);
  expect(items.some(item => /^E\b.*Delete/.test(item))).toBe(true);
});

it("u7676c_unfinished_work_survives_a_file_switch_and_marks_its_row", async () => {
  await openDiff();
  startNote();
  fireEvent.input(field(), { target: { value: "half" } });
  await openFile("src/deep/b.ts");
  await waitFor(async () => expect((await treeRow("src/a.ts")).getAttribute("aria-label")).toContain(copy.unfinishedWork));
  await openFile("src/a.ts");
  await waitFor(() => expect(field().value).toBe("half"));
  fireEvent.keyDown(field(), { key: "Escape" });
  await waitFor(() => expect(document.querySelector("diffs-container")).not.toBeNull());
  expect(vi.mocked(VirtualizedFileDiff.prototype.render).mock.calls.flatMap(([input]) => input?.lineAnnotations ?? []).some(entry => "unfinished" in entry.metadata)).toBe(true);
});

it("u7676c_a_saved_note_says_not_sent_and_editing_keeps_it_until_save", async () => {
  const { app } = await openDiff();
  await saveNote("saved");
  expect(within(batch()).getByText(new RegExp(copy.notSent))).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: copy.editNote(1) }));
  fireEvent.input(field(), { target: { value: "changed" } });
  expect(firstNote(app).text).toBe("saved");
  fireEvent.keyDown(field(), { key: "Escape" });
  expect(firstNote(app).text).toBe("saved");
  expect(notesFor(app, "/p").unfinished("a").map(draft => draft.text)).toEqual(["changed"]);
});

it("u7676c_a_sending_note_is_locked", async () => {
  const { app } = await openDiff();
  await saveNote("one");
  app.handlers["message.send"] = () => new Promise(() => {});
  fireEvent.click(sendButton());
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  await openBatch();
  expect(within(batch()).getByText(new RegExp(copy.sending))).toBeTruthy();
  expect(screen.queryByRole("button", { name: copy.editNote(1) })).toBeNull();
  expect(screen.queryByRole("button", { name: copy.removeNote(1) })).toBeNull();
  fireEvent.click(sendButton());
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
});

it("u7676c_a_rejected_note_says_couldnt_send_and_stays_editable", async () => {
  const { app } = await openDiff();
  await saveNote("one");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "receiver ended"); };

  fireEvent.click(sendButton());
  await openBatch();
  await within(batch()).findByText(new RegExp(copy.couldntSend));
  expect(screen.getByRole("button", { name: copy.editNote(1) })).toBeTruthy();
  expect(screen.getByRole("button", { name: copy.removeNote(1) })).toBeTruthy();
});

it("u7676c_an_unknown_acceptance_locks_the_note_and_offers_no_resend", async () => {
  const { app } = await openDiff();
  await saveNote("one");
  app.handlers["message.send"] = () => { throw new Error("disconnected"); };

  fireEvent.click(sendButton());
  await screen.findByRole("button", { name: copy.checkMessageHistory });
  await openBatch();
  expect(within(batch()).getByText(new RegExp(copy.sendUnknown))).toBeTruthy();
  expect(screen.queryByRole("button", { name: copy.editNote(1) })).toBeNull();
  expect(screen.queryByRole("button", { name: /Send notes:|Retry/ })).toBeNull();
});

it("u7676c_restored_notes_are_counted_on_the_bar", async () => {
  const first = await openDiff();
  await saveNote("one");
  await saveNote("two");
  first.view.unmount();
  await openDiff();
  await screen.findByText(copy.notesKept(2));
  await saveNote("three");
  expect(screen.queryByText(copy.notesKept(2))).toBeNull();
  cleanup();
  await openDiff();
  await screen.findByText(copy.notesKept(3));
  fireEvent.click(within(bar()).getByRole("button", { name: copy.dismissLine }));
  await waitFor(() => expect(screen.queryByText(copy.notesKept(3))).toBeNull());
});

it("u7676c_notes_for_lines_no_longer_shown_gather_after_the_last_line", async () => {
  const { app, connected } = await openDiff();
  await saveNote("original");
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, new: { kind: "text", revision: "later-revision", text: "different\n" } });
  await connected.worktrees.refresh("a");
  const group = await screen.findByRole("list", { name: copy.notesNoLongerShown });
  expect(within(group).getAllByRole("listitem").length).toBe(1);
  expect(within(group).getByText(new RegExp(copy.originalContext))).toBeTruthy();
});

it("u7676d_the_bar_shows_only_for_unsent_notes_or_a_send", async () => {
  await openDiff();
  expect(screen.queryByLabelText(copy.notesRegion, { selector: "section" })).toBeNull();
  startNote();
  fireEvent.input(field(), { target: { value: "half" } });
  fireEvent.keyDown(field(), { key: "Escape" });
  expect(screen.queryByLabelText(copy.notesRegion, { selector: "section" })).toBeNull();
  startNote();
  fireEvent.click(form().getByRole("button", { name: "Save" }));
  await screen.findByLabelText(copy.notesRegion, { selector: "section" });
});

it("u7676d_the_count_opens_the_batch_list_by_keyboard", async () => {
  await openDiff();
  await saveNote("one");
  fireEvent.click(within(bar()).getByRole("button", { name: "1 note" }));
  const count = within(bar()).getByRole("button", { name: "1 note" });
  expect(noteList()).toBeNull();
  count.focus();
  fireEvent.click(count);
  await screen.findByRole("list", { name: copy.notes });
  fireEvent.keyDown(count, { key: "Escape" });
  await waitFor(() => expect(noteList()).toBeNull());
});

it("u7676d_the_sent_line_names_the_count_and_the_agent", async () => {
  const { app } = await openDiff();
  await saveNote("one");
  app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  fireEvent.click(sendButton());
  await screen.findByText(copy.notesSent(1, "a"));
  fireEvent.click(within(bar()).getByRole("button", { name: copy.dismissLine }));
  await waitFor(() => expect(screen.queryByText(copy.notesSent(1, "a"))).toBeNull());
});

it("u7676d_retry_is_for_a_definite_rejection_only", async () => {
  const { app } = await openDiff();
  await saveNote("one");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "receiver ended"); };

  fireEvent.click(sendButton());
  await screen.findByText(/Couldn't send 1 note/);
  await screen.findByText("receiver ended");
  app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  fireEvent.click(await within(bar()).findByRole("button", { name: copy.retry }));
  await screen.findByText(copy.notesSent(1, "a"));
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(2);
});

it("u7676d_remove_offers_undo_for_five_seconds", async () => {
  const { app } = await openDiff();
  await saveNote("one");
  await saveNote("two");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fireEvent.click(screen.getByRole("button", { name: copy.removeNote(1) }));
  await vi.advanceTimersByTimeAsync(10);
  await vi.advanceTimersByTimeAsync(3000);
  fireEvent.click(screen.getByRole("button", { name: copy.removeNote(1) }));
  await vi.advanceTimersByTimeAsync(10);
  expect(notesFor(app, "/p").list("a")).toEqual([]);
  // The first removal is 3 s old and the second fresh: Undo brings back the latest.
  fireEvent.click(screen.getByRole("button", { name: copy.undo }));
  await vi.advanceTimersByTimeAsync(10);
  expect(notesFor(app, "/p").list("a").map(note => note.text)).toEqual(["two"]);
  await vi.advanceTimersByTimeAsync(5001);
  expect(screen.queryByText(copy.noteRemoved)).toBeNull();
});

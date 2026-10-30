import { copy as recoveryCopy } from "../sharedCopy";
import { parse } from "flatted";
import { notesFor } from "./notes";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { agent, event } from "../testing/nodes";
import { WORKTREE } from "./harness";
import { message } from "../testing/centreFixture";
import { afterEach, expect, it, vi } from "vitest";
import { COMPARISON, openDiff, openFile, saveNote } from "./noteHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("u2540b_save_cancel_and_invalid_ranges", async () => {
  await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  const save = screen.getByRole("button", { name: "Save" });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  keep exact\ntext  " } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "99" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "1" } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "Start line" }), { target: { value: "2" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("spinbutton", { name: "Start line" }), { target: { value: "0" } });
  expect(save.hasAttribute("disabled")).toBe(true);
  fireEvent.input(screen.getByRole("spinbutton", { name: "Start line" }), { target: { value: "1" } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "2" } });
  fireEvent.click(save);
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("  keep exact\ntext  ");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "cancel me" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("list", { name: "Notes" }).textContent).not.toContain("cancel me");
});

it("u2540b_edit_remove_and_batch_across_files", async () => {
  await openDiff();
  await saveNote("first");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await openFile("src/deep/b.ts");
  await saveNote("second");
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "edited first" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const batch = screen.getByRole("list", { name: "Notes" });
  expect(batch.textContent).toContain("edited first");
  expect(batch.textContent).toContain("src/deep/b.ts");
  fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
  expect(batch.textContent).not.toContain("edited first");
  expect(batch.textContent).toContain("second");
});

it("u2773a_changes_agent_switch_restores_form", async () => {
  const secondText = "for b only";
  const firstText = "for a only";
  const { app, connected } = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: firstText } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unfinished a 🐝\n  " } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: WORKTREE }), agent("b", "working", "building", { worktree: { ...WORKTREE, branch: "roundup/b", path: "/p/b" } })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.some(node => node.id === "b")).toBe(true));
  connected.rail.select("b");
  fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
  expect(screen.queryByRole("list")).toBeNull();
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: secondText } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unfinished b e\u0301\n  " } });
  connected.rail.select("a");
  fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
  const batch = await screen.findByRole("list", { name: "Notes" });
  expect(batch.textContent).toContain(firstText);
  expect(batch.textContent).not.toContain(secondText);
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  unfinished a 🐝\n  ");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  fireEvent.click(screen.getByRole("button", { name: /Send to/ }));
  connected.rail.select("b");
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "message.send")?.params).toMatchObject({ to: "a" });
  fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
  expect((await screen.findByRole("list", { name: "Notes" })).textContent).toContain(secondText);
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  unfinished b e\u0301\n  ");
});

it("u2540b_refresh_keeps_original_context", async () => {
  const { app } = await openDiff();
  await saveNote("original");
  app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, new: { kind: "text", revision: "later-revision", text: "different\n" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await within(screen.getByRole("list", { name: "Notes" })).findByRole("status");
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "original");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  app.handlers["message.send"] = params => message(1, { body: params.body, to: params.to });
  fireEvent.click(screen.getByRole("button", { name: /Send to/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  const body = app.calls.find(call => call.method === "message.send")!.params;
  expect(JSON.stringify(body)).toContain("new-revision");
  expect(JSON.stringify(body)).not.toContain("later-revision");
});

it("u2773a_changes_restores_exact_work", async () => {
  const saved = "  saved e\u0301 🐝\nexact  ";
  const unfinished = "  unfinished 🐝\n e\u0301  ";
  const { view } = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: saved } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit note 1" });
  await waitFor(() => { if (screen.queryByRole("textbox", { name: "Note" })) throw new Error("Note persistence is pending"); });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: unfinished } });
  fireEvent.input(screen.getByRole("spinbutton", { name: "End line" }), { target: { value: "2" } });
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
  field.setSelectionRange(2, 7, "backward");
  fireEvent.select(field);
  await waitFor(() => expect(localStorage.getItem("roundup:drafts:/p")).toContain("unfinished"));
  view.unmount();
  const { app, connected } = await openDiff();
  expect(notesFor(app, connected.project.path, connected.drafts).list("a").map(note => note.text)).toEqual([saved]);
  const add = screen.getByRole("button", { name: "Add note" });
  add.focus();
  app.emit(event({ name: "rail.changed" }));
  expect(document.activeElement).toBe(add);
  fireEvent.click(add);
  const restored = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
  await waitFor(() => expect(document.activeElement).toBe(restored));
  expect(restored.value).toBe(unfinished);
  expect([restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([2, 7, "backward"]);
  expect(screen.getByRole("spinbutton", { name: "End line" })).toHaveProperty("value", "2");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773e_recovery_actions_keep_surface_draft", async () => {
  const saved = "older saved note";
  const memory = "  memory 🐝\nnewer  ";
  const { app, view, connected } = await openDiff();
  const retrying = vi.spyOn(notesFor(app, "/p", connected.drafts), "retry");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: saved } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit note 1" });
  await waitFor(() => { if (screen.queryByRole("textbox", { name: "Note" })) throw new Error("Note persistence is pending"); });
  const before = localStorage.getItem("roundup:drafts:/p");
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: memory } });
  await screen.findByRole("alert");
  expect(localStorage.getItem("roundup:drafts:/p")).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Review recovery options" }));
  await waitFor(() => { if (screen.queryByRole("dialog", { name: "Worktree" })) throw new Error("Previous dialog remains mounted"); });
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  const copyText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
  vi.spyOn(app, "clipboardWrite").mockImplementation(copyText);
  fireEvent.click(within(recovery).getAllByRole("button", { name: "Copy" })[0]!);
  await waitFor(() => expect(copyText).toHaveBeenCalledOnce());
  expect(copyText.mock.calls[0]?.[0]).toContain("memory 🐝");
  write.mockRestore();
  fireEvent.click(within(recovery).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(within(recovery).queryByRole("alert")).toBeNull());
  await retrying.mock.results[0]!.value;
  view.unmount();
  const reopened = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  memory 🐝\nnewer  ");
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const blockedWrite = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "temporary" } });
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: memory } });
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  await screen.findByRole("alert");
  blockedWrite.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  const recovered = await screen.findByRole("dialog", { name: "Recover notes" });
  // The form is first; discard only that draft, keeping the older saved batch note.
  const discarding = vi.spyOn(notesFor(reopened.app, "/p"), "discardForm");
  fireEvent.click(within(recovered).getAllByRole("button", { name: recoveryCopy.discardRevision })[0]!);
  await discarding.mock.results[0]!.value;
  expect(recovered.textContent).not.toContain(memory.trim());
  await waitFor(() => expect(parse(JSON.parse(localStorage.getItem("roundup:drafts:/p")!).drafts.find((draft: { destination: { surface: string } }) => draft.destination.surface === "changes").value.data).forms).toEqual([]));
  reopened.view.unmount();
  const final = await openDiff();
  expect(notesFor(final.app, final.connected.project.path, final.connected.drafts).list("a").map(note => note.text)).toEqual([saved]);
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it.each(["invalid", "unreadable"])("u2773e_changes_restore_failure_keeps_memory_%s", async cause => {
  const original = cause === "invalid" ? "{broken" : null;

  if (original) localStorage.setItem("roundup:drafts:/p", original);
  const read = cause === "unreadable" ? vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); }) : null;
  await openDiff();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "retain exact newer" } });
  read?.mockRestore();

  if (original) expect(localStorage.getItem("roundup:drafts:/p")).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "retain exact newer");
});

it("u2773c_changes_worktree_loss_and_return_keep_original_form", async () => {
  const noteText = "  original Worktree e\u0301\n🐝  ";
  const { app, connected } = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: noteText } });
  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: null })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.find(node => node.id === "a")?.worktree).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  expect(recovery.textContent).toContain(noteText);
  expect(document.querySelector('[data-note-action="resume"]')).toBeNull();
  fireEvent.click(within(recovery).getByRole("button", { name: "Close" }));
  app.handlers["rail.tree"] = () => [agent("a", "working", "building", { worktree: WORKTREE })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(document.querySelector(".note-recovery")).toBeNull());
  fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", noteText);
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773c_changes_unavailable_original_keeps_recovery", async () => {
  const unavailableText = "  unavailable exact 🐝  ";
  const { app, connected } = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: unavailableText } });
  app.handlers["rail.tree"] = () => [agent("replacement", "working", "building", { name: "a", worktree: WORKTREE })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.some(node => node.id === "a")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  expect(recovery.textContent).toContain(unavailableText);
  expect(document.querySelector('[data-note-action="resume"]')).toBeNull();
  expect(within(recovery).getByRole("status")).toBeTruthy();
  const copied = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
  vi.spyOn(app, "clipboardWrite").mockImplementation(copied);
  fireEvent.click(within(recovery).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(copied).toHaveBeenCalledOnce());
  expect(JSON.parse(copied.mock.calls[0]?.[0] ?? "null")).toMatchObject({ recipient: "a", form: { text: "  unavailable exact 🐝  ", comparison: COMPARISON } });
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773e_changes_retry_read_keeps_older_work_separate", async () => {
  const older = "older retained work";
  const newer = "newer memory work";
  const first = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: older } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit note 1" });
  await waitFor(() => { if (screen.queryByRole("textbox", { name: "Note" })) throw new Error("Note persistence is pending"); });
  first.view.unmount();
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("temporarily unreadable"); });
  const current = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: newer } });
  read.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  fireEvent.click(within(recovery).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(recovery.textContent).toContain(older));
  expect(recovery.textContent).toContain(newer);
  current.view.unmount();
  const reopened = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", newer);
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  expect((await screen.findByRole("dialog", { name: "Recover notes" })).textContent).toContain(older);
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773a_changes_recovery_switch_keeps_single_editor", async () => {
  const { app } = await openDiff();
  const blockedWrite = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "first editor work" } });
  await screen.findByRole("alert");
  blockedWrite.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  await waitFor(() => { if (screen.queryByRole("dialog", { name: "Worktree" })) throw new Error("Previous dialog remains mounted"); });
  fireEvent.click(within(recovery).getByRole("button", { name: "Resume note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "newer recovery editor work 🐝" } });
  fireEvent.click(screen.getByRole("button", { name: /\d+ changed files?/ }));
  await waitFor(() => { if (screen.queryByRole("dialog", { name: "Recover notes" })) throw new Error("Previous dialog remains mounted"); });
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "newer recovery editor work 🐝");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773e_changes_connection_replacement_keeps_memory", async () => {
  const first = await openDiff();
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  original memory e\u0301\n🐝  " } });
  await screen.findByRole("alert");
  first.view.unmount();
  write.mockRestore();
  const next = await openDiff("/p", first.connected.drafts);
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  original memory e\u0301\n🐝  ");
  expect(next.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  next.app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: /Send to/ }));
  await waitFor(() => expect(next.app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  expect(next.app.calls.find(call => call.method === "message.send")?.params).toMatchObject({ to: "a" });
  expect(first.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u3474e_mutation_keeps_the_next_key_live", async () => {
  await openDiff();
  await saveNote("first");
  await saveNote("second");
  const remove = screen.getByRole("button", { name: "Remove note 1" });
  remove.focus();
  fireEvent.click(remove);
  const next = screen.getByRole("button", { name: "Remove note 1" });
  await waitFor(() => expect(document.activeElement).toBe(next));
  fireEvent.click(document.activeElement!);
  await waitFor(() => expect(screen.queryByRole("list")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
});

it("u3474e_saving_a_note_returns_to_a_live_control", async () => {
  await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  const field = screen.getByRole("textbox", { name: "Note" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "keep this" } });
  const save = screen.getByRole("button", { name: "Save" });
  save.focus();
  fireEvent.click(save);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add note" })));
  fireEvent.click(document.activeElement!);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Note" })));
});

it("u3474e_sending_the_batch_returns_to_a_live_control", async () => {
  const { app } = await openDiff();
  await saveNote("reviewed");
  app.handlers["message.send"] = params => message(1, { to: params.to, body: params.body });
  const send = screen.getByRole("button", { name: /Send to/ });
  send.focus();
  fireEvent.click(send);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" })));
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
  fireEvent.click(document.activeElement!);
  expect(screen.queryByRole("region", { name: "Diff" })).toBeNull();
});

it.each(["dismiss", "copy same", "copy other", "discard", "failed discard"].map(action => ({ scope: "note", action })))("p3557c_failure_lifetime_note_recovery: $scope $action", async ({ action }) => {
  const { app, connected } = await openDiff();
  await saveNote("  copied note e\u0301\n🐝  ");
  await saveNote("  other note 🐝  ");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unfinished e\u0301\n🐝  " } });
  app.handlers["rail.tree"] = () => [agent("plain", "working", "building")];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.some(node => node.id === "a")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  const first = within(recovery).getByText("  copied note e\u0301\n🐝  ", { normalizer: value => value }).parentElement!;
  const other = within(recovery).getByText("  other note 🐝  ", { normalizer: value => value }).parentElement!;
  const copied = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("clipboard refused"));
  vi.spyOn(app, "clipboardWrite").mockImplementation(copied);
  const source = within(first).getByRole("button", { name: "Copy" });

  fireEvent.click(source);
  await within(recovery).findByRole("alert");
  copied.mockResolvedValue();
  let blocked: ReturnType<typeof vi.spyOn> | undefined;

  if (action === "dismiss") fireEvent.click(within(recovery).getByRole("button", { name: "Dismiss" }));
  else if (action.includes("discard")) {
    if (action === "failed discard") blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk refused"); });
    fireEvent.click(within(first).getByRole("button", { name: recoveryCopy.discardRevision }));
  } else {
    fireEvent.click(action === "copy same" ? source : within(other).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(copied).toHaveBeenCalledTimes(2));
  }

  await waitFor(() => expect(within(recovery).queryAllByRole("alert").length > 0).toBe(action === "copy other" || action === "failed discard"));
  expect(JSON.parse(copied.mock.calls[0]![0])).toMatchObject({ project: "/p", recipient: "a", note: { text: "  copied note e\u0301\n🐝  " } });
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  blocked?.mockRestore();
});

it.each(["save", "cancel"])("p3557c_failure_lifetime_note_recovery_form: %s", async action => {
  const exact = "  exact form e\u0301\n🐝  ";
  const saved = "unrelated saved note";
  const { app } = await openDiff();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: saved } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit note 1" });
  await waitFor(() => { if (screen.queryByRole("textbox", { name: "Note" })) throw new Error("Note persistence is pending"); });
  app.handlers["message.send"] = () => { throw new Error("reply lost"); };

  fireEvent.click(screen.getByRole("button", { name: /Send to/ }));
  await screen.findByRole("button", { name: "Check Message history" });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: exact } });
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  const form = within(recovery).getByText(exact, { normalizer: value => value }).parentElement!;
  vi.spyOn(app, "clipboardWrite").mockRejectedValue(new Error("refused"));
  fireEvent.click(within(form).getByRole("button", { name: "Copy" }));
  await within(recovery).findByRole("alert");
  fireEvent.click(within(form).getByRole("button", { name: "Resume note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", exact);
  fireEvent.click(within(recovery).getByRole("button", { name: action === "save" ? "Save" : "Cancel" }));
  await waitFor(() => expect(within(recovery).queryByRole("alert") !== null).toBe(action === "cancel"));
  expect(recovery.textContent).toContain(exact);
  expect(recovery.textContent).toContain(saved);
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
});

it("u2539b_zero_changes_keeps_the_original_note_revision_recoverable", async () => {
  const { app, connected } = await openDiff();
  const text = "  Keep this original note\ne\u0301 🐝  ";
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: text } });
  const original = structuredClone(connected.drafts.list());
  app.handlers["agent.changedFiles"] = () => ({ files: [] });
  await connected.worktrees.refresh("a");
  await waitFor(() => expect(document.querySelector(".worktree-control, .worktree-panel")).toBeNull());
  expect(connected.drafts.list()).toEqual(original);
  connected.showView("notes");
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  expect(recovery.textContent).toContain(text);
  fireEvent.click(within(recovery).getByRole("button", { name: "Close" }));
  app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", status: "modified", line: 1 }] });
  await connected.worktrees.refresh("a");
  fireEvent.click(await screen.findByRole("button", { name: /\d+ changed files?/ }));
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", text);
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u4277b_empty_recovery_has_no_copy_action", async () => {
  const { openTabs } = await import("../header/stripFixture");
  const { openProjectPage } = await import("../testing/menuProbe");
  const { app } = await openTabs({ api: [] });
  openProjectPage("view:notes");
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  expect(within(recovery).getAllByRole("button")).toHaveLength(1);
  expect(app.calls.filter(call => /spawn|send|importCommit/.test(call.method))).toHaveLength(0);
  fireEvent.click(within(recovery).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(recovery.isConnected).toBe(false));
});

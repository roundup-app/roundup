import { renderTabs, path, tab, projectTabs } from "../header/stripFixture";
import { notesFor } from "./notes";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "@contracts/message/Message";
import { RpcError } from "../app/seam";
import { message } from "../testing/centreFixture";
import { COMPARISON, noteList, openDiff, openFile, saveNote, openChanges, startNote, openBatch, cancelNote } from "./noteHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("u2540c_one_message_contains_all_original_context", async () => {
  const { app } = await openDiff();
  await saveNote("  exact\ncomment <script>  ");
  await openFile("src/deep/b.ts");
  await saveNote("second");
  let accepted: unknown;
  app.handlers["message.send"] = params => { accepted = JSON.parse(params.body);

 return message(1, { to: params.to, body: params.body }); };

  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "message.send")?.params).toMatchObject({ to: "a", kind: "note", replyTo: null });
  expect(accepted).toMatchObject({ notes: [
    { "File:": { old: "src/a.ts", new: "src/a.ts" }, "Base:": "base-commit", "Content revisions:": { old: "old-revision", new: "new-revision" }, "Lines:": "new 1-1", "Selected source:": "after", "User comment:": "  exact\ncomment <script>  " },
    { "File:": { new: "src/deep/b.ts" }, "User comment:": "second" },
  ] });
});

it("u2540c_empty_batch_sends_nothing", async () => {
  const { app } = await openDiff();
  expect(screen.queryByRole("button", { name: /Send notes:|Retry/ })).toBeNull();
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2540c_acceptance_clears_only_the_submitted_batch", async () => {
  const { app } = await openDiff();
  await saveNote("submitted");
  let resolve!: (value: Message) => void;
  app.handlers["message.send"] = () => new Promise(done => { resolve = done; });
  const send = within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ });
  fireEvent.click(send);
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  fireEvent.click(send);
  await saveNote("added meanwhile");
  resolve(message(1, { to: "a", status: "pending" }));
  await waitFor(() => expect(notesFor(app, "/p").list("a").map(note => note.text)).toEqual(["added meanwhile"]));
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
  await screen.findByText("Sent 1 note to a");
});

it("u2540c_rejection_and_unknown_acceptance_preserve_notes", async () => {
  const { app } = await openDiff();
  const noteText = "keep";
  await saveNote(noteText);
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "receiver ended"); };

  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await screen.findByText("receiver ended");
  expect(notesFor(app, "/p").list("a").map(note => note.text)).toEqual([noteText]);
  let body = "";
  app.handlers["message.send"] = params => { body = params.body; throw new Error("disconnected"); };

  // U170: the failed send keeps its button busy until the send settles.
  await waitFor(() => expect(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }).matches("[aria-busy]")).toBe(false));
  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await screen.findByRole("button", { name: "Check Message history" });
  // U7676d: an unknown acceptance offers neither Send nor Retry.
  expect(screen.queryByRole("button", { name: /Send notes:|Retry/ })).toBeNull();
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(2);
  app.handlers["message.list"] = () => [message(9, { from: { kind: "user", id: "you", parent: null }, to: "a", body, status: "pending" })];
  fireEvent.click(screen.getByRole("button", { name: "Check Message history" }));
  await waitFor(() => expect(noteList()).toBeNull());
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(2);
});


it.each(["failed", "acknowledged", "unknown"] as const)("u2773b_changes_settlement_preserves_other_revisions_%s", async outcome => {
  const { app, view } = await openDiff();
  await saveNote("  revision A 🐝\n e\u0301  ");
  let resolve!: (value: Message) => void;
  let reject!: (error: Error) => void;
  app.handlers["message.send"] = () => new Promise((done, fail) => { resolve = done; reject = fail; });
  const sending = vi.spyOn(notesFor(app, "/p"), "send");
  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  // U7676c: a Sending note is locked in the view; the store still settles a replacement made meanwhile.
  const locked = notesFor(app, "/p").list("a")[0]!;
  await notesFor(app, "/p").save("a", { ...locked, text: "  revision B 🐝\n newer  " }, locked.id);
  await waitFor(() => { if (screen.queryByRole("textbox", { name: "Note" })) throw new Error("Note save remains pending"); });

  if (outcome === "acknowledged") resolve(message(1, { to: "a" }));
  else reject(outcome === "failed" ? new RpcError(-32003, "refused A") : new Error("lost reply A"));
  await waitFor(() => expect(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }).getAttribute("aria-disabled") === "true").toBe(outcome === "unknown"));

  if (outcome === "failed") await screen.findByText("refused A");

  await sending.mock.results[0]!.value;
  view.unmount();
  const reopened = await openDiff();
  expect(notesFor(reopened.app, "/p").list("a").map(note => note.text)).toEqual(["  revision B 🐝\n newer  "]);
  fireEvent.click(screen.getByRole("button", { name: "Close changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);

  if (outcome === "acknowledged") {
    expect(notesFor(reopened.app, "/p").entries()[0]?.[1].submissions).toEqual([]);
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
    const recovery = await screen.findByRole("dialog", { name: "Recover notes" });

    expect(notesFor(reopened.app, "/p").entries()[0]?.[1].submissions[0]?.notes.map(note => note.text)).toEqual(["  revision A 🐝\n e\u0301  "]);
    fireEvent.click(screen.getByRole("button", { name: "Discard this submission" }));
    expect(notesFor(reopened.app, "/p").entries()[0]?.[1].submissions).toEqual([]);
    reopened.view.unmount();
    await openDiff();
    expect(notesFor(reopened.app, "/p").list("a").map(note => note.text)).toEqual(["  revision B 🐝\n newer  "]);
  }
});

it("u2773b_changes_pending_reload_reconciles_without_resending", async () => {
  const { app, view } = await openDiff();
  await saveNote("acknowledged remotely");
  let body = "";
  let acknowledge!: (value: Message) => void;
  app.handlers["message.send"] = params => { body = params.body;

 return new Promise(done => { acknowledge = done; }); };

  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  view.unmount();
  const reopened = await openDiff();
  reopened.app.handlers["message.list"] = () => [message(42, { body, to: "a", from: { kind: "user", id: "you", parent: null } })];
  expect(screen.queryByRole("button", { name: /Send notes:|Retry/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check Message history" }));
  await waitFor(() => expect(noteList()).toBeNull());
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  acknowledge(message(42, { body, to: "a" }));
});


it("u2773b_changes_late_failure_stays_with_original_project", async () => {
  const submitted = "submitted A";
  const newer = "newer A";
  const other = "Project B exact 🐝";
  const { agent } = await import("../testing/nodes");
  const { WORKTREE, STATE } = await import("./harness");
  const { app } = renderTabs({ api: [agent("a", "working", "building", { worktree: WORKTREE })], web: [agent("b", "working", "building", { worktree: { ...WORKTREE, branch: "roundup/b" } })] });

  for (const name of ["api", "web"]) {
    const daemon = app.of(path(name));
    daemon.handlers["agent.worktreeState"] = () => STATE;
    const files = [{ path: "src/a.ts", status: "modified" as const, line: 1, counts: null, blob: null }];

    daemon.handlers["agent.changedFiles"] = () => ({ files });
    daemon.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: WORKTREE.path, branch: WORKTREE.branch, base: WORKTREE.base, files }] });
    daemon.handlers["agent.compareFile"] = () => COMPARISON;
  }

  await waitFor(() => expect(projectTabs().every(tab => tab.getAttribute("aria-busy") === "false")).toBe(true));
  fireEvent.click(tab("api"));
  fireEvent.click(await screen.findByText("a", { selector: ".name" }));
  await screen.findByText("a", { selector: "[role=treeitem][aria-selected=true] .name" });
  await openChanges();
  await openFile();
  await saveNote(submitted);
  const original = app.of(path("api"));
  let refuse!: (error: Error) => void;
  original.handlers["message.send"] = () => new Promise((_done, reject) => { refuse = reject; });
  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await waitFor(() => expect(original.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  // U7676c: a Sending note is locked in the view; the store still settles a replacement made meanwhile.
  const locked = notesFor(original, path("api")).list("a")[0]!;
  await notesFor(original, path("api")).save("a", { ...locked, text: newer }, locked.id);
  fireEvent.click(tab("web"));
  fireEvent.click(await screen.findByText("b", { selector: ".name" }));
  await screen.findByText("b", { selector: "[role=treeitem][aria-selected=true] .name" });
  await openChanges();
  await openFile();
  await saveNote(other);
  refuse(new RpcError(-32003, "original Project refused"));
  fireEvent.click(tab("api"));

  await screen.findByText("a", { selector: "[role=treeitem][aria-selected=true] .name" });
  await openChanges();
  await screen.findByText("original Project refused");
  await openBatch();
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  expect((await screen.findByLabelText<HTMLTextAreaElement>("Note", { selector: "textarea" })).value).toBe(newer);
  cancelNote();
  fireEvent.click(tab("web"));

  await screen.findByText("b", { selector: "[role=treeitem][aria-selected=true] .name" });
  await openChanges();
  await openBatch();
  fireEvent.click(await screen.findByRole("button", { name: "Edit note 1" }));
  expect((await screen.findByLabelText<HTMLTextAreaElement>("Note", { selector: "textarea" })).value).toBe(other);
  expect(app.of(path("web")).calls.filter(call => call.method === "message.send")).toHaveLength(0);
  expect(original.calls.filter(call => call.method === "message.send")).toHaveLength(1);
}, 45_000); // two Projects, two opened diffs: ~10x its peers (~3 s here), so CI shard load crossed the 15 s default.


it("u2773e_changes_lost_history_baseline_never_authorizes_resend", async () => {
  const { app, view } = await openDiff();
  await saveNote("exact possibly accepted note");
  let body = "";
  let write: ReturnType<typeof vi.spyOn> | undefined;
  app.handlers["message.list"] = () => {
    // The first pending snapshot is durable; retaining the fetched history then fails.
    write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage refused metadata"); });

    return [];
  };

  app.handlers["message.send"] = params => { body = params.body; throw new Error("lost accepted reply"); };

  const sending = vi.spyOn(notesFor(app, "/p"), "send");
  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await screen.findByRole("button", { name: "Check Message history" });
  await sending.mock.results[0]!.value;
  view.unmount();
  write?.mockRestore();
  const reopened = await openDiff();
  reopened.app.handlers["message.list"] = () => [message(42, { body, to: "a", from: { kind: "user", id: "you", parent: null } })];
  const retained = vi.spyOn(Storage.prototype, "setItem");
  fireEvent.click(screen.getByRole("button", { name: "Check Message history" }));
  // reconcile persists its settlement before returning; wait for that emitted boundary, not the request count.
  await waitFor(() => expect(retained.mock.calls.some(([key]) => key === "roundup:drafts:/p")).toBe(true));
  expect(screen.queryByRole("button", { name: /Send notes:|Retry/ })).toBeNull();
  expect(notesFor(reopened.app, "/p").list("a").map(note => note.text)).toEqual(["exact possibly accepted note"]);
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773b_changes_reconnect_failure_preserves_newer_revision", async () => {
  const older = "older connection revision A";
  const newer = "new connection revision B 🐝";
  const first = await openDiff();
  startNote();
  fireEvent.input(screen.getByLabelText("Note", { selector: "textarea" }), { target: { value: older } });
  fireEvent.click(within(screen.getByLabelText("Line note", { selector: "form" })).getByRole("button", { name: "Save" }));
  await openBatch();
  await screen.findByRole("button", { name: "Edit note 1" });
  await waitFor(() => { if (screen.queryByRole("textbox", { name: "Note" })) throw new Error("Note persistence is pending"); });
  let refuse!: (error: Error) => void;
  first.app.handlers["message.send"] = () => new Promise((_done, reject) => { refuse = reject; });
  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await waitFor(() => expect(first.app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  first.view.unmount();
  const next = await openDiff("/p", first.connected.drafts);
  // U7676c: a Sending note is locked in the view; the store still settles a replacement made meanwhile.
  const locked = notesFor(next.app, "/p").list("a")[0]!;
  await notesFor(next.app, "/p").save("a", { ...locked, text: newer }, locked.id);
  refuse(new RpcError(-32003, "original connection refused"));
  await screen.findByText("original connection refused");
  await openBatch();
  expect(screen.getAllByText(newer).length).toBeGreaterThan(0);
  expect(next.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  expect(recovery.textContent).toContain(older);
  expect(within(recovery).getAllByText(newer).length).toBeGreaterThan(0);
  next.view.unmount();
  await openDiff("/p", first.connected.drafts);
  await openBatch();
  expect(screen.getAllByText(newer).length).toBeGreaterThan(0);
});

it.each(["remove", "save", "dismiss", "other remove", "other save", "cancel edit"])("p3557c_failure_lifetime_note_batch: %s", async action => {
  const { app } = await openDiff();
  const exact = "  original e\u0301\n🐝  ";
  await saveNote(exact);
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "recipient refused; edit or retry notes"); };

  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await screen.findByText("recipient refused; edit or retry notes");
  await saveNote("  unrelated 🐝\n exact  ");
  startNote();
  const field = screen.getByLabelText("Note", { selector: "textarea" });
  fireEvent.input(field, { target: { value: "  unfinished e\u0301\n🐝  " } });

  await openBatch();

  if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  else if (action.endsWith("remove")) fireEvent.click(screen.getByRole("button", { name: action === "remove" ? "Remove note 1" : "Remove note 2" }));
  else {
    cancelNote();
    await openBatch();
    fireEvent.click(screen.getByRole("button", { name: action === "other save" ? "Edit note 2" : "Edit note 1" }));

    if (action === "cancel edit") cancelNote();
    else {
      fireEvent.input(screen.getByLabelText("Note", { selector: "textarea" }), { target: { value: "  acknowledged replacement 🐝  " } });
      fireEvent.click(within(screen.getByLabelText("Line note", { selector: "form" })).getByRole("button", { name: "Save" }));
    }

    startNote();
  }

  await waitFor(() => expect(Boolean(notesFor(app, "/p").failure("a"))).toBe(action.startsWith("other") || action === "cancel edit"));
  expect(screen.getByLabelText("Note", { selector: "textarea" })).toHaveProperty("value", "  unfinished e\u0301\n🐝  ");
  await openBatch();
  const list = screen.getByRole("list", { name: "Notes" });
  expect(list.textContent).toContain(action === "other save" ? "  acknowledged replacement 🐝  " : action === "other remove" ? exact : "  unrelated 🐝\n exact  ");
  expect(app.calls.filter(call => call.method === "message.send").map(call => call.params)).toEqual([expect.objectContaining({ to: "a", body: expect.stringContaining(exact.replaceAll("\n", "\\n")) })]);
});

it.each(["remove", "save", "dismiss"])("p3557c_failure_lifetime_note_batch_load: %s", async action => {
  const { app } = await openDiff();
  await saveNote("  original note e\u0301\n🐝  ");
  app.handlers["message.list"] = () => { throw new RpcError(-32003, "history refused; retry loading history"); };

  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await screen.findByText("history refused; retry loading history");

  await openBatch();

  if (action === "remove") fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
  else if (action === "save") {
    await openBatch();
    fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
    fireEvent.input(screen.getByLabelText("Note", { selector: "textarea" }), { target: { value: "  revised 🐝  " } });
    fireEvent.click(within(screen.getByLabelText("Line note", { selector: "form" })).getByRole("button", { name: "Save" }));
  } else fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText("history refused; retry loading history") !== null).toBe(action !== "dismiss");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it.each(["dismiss", "remove", "save"])("p3557c_failure_lifetime_note_batch_retention: %s", async action => {
  const { app } = await openDiff();
  await saveNote("  original note e\u0301\n🐝  ");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "recipient refused; retry"); };

  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await screen.findByText("recipient refused; retry");
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk refused"); });
  startNote();
  fireEvent.input(screen.getByLabelText("Note", { selector: "textarea" }), { target: { value: "  in memory e\u0301\n🐝  " } });

  await openBatch();

  if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  else if (action === "remove") fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
  else {
    cancelNote();
    await openBatch();
    fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
    fireEvent.input(screen.getByLabelText("Note", { selector: "textarea" }), { target: { value: "  cannot retain save 🐝  " } });
    fireEvent.click(within(screen.getByLabelText("Line note", { selector: "form" })).getByRole("button", { name: "Save" }));
    startNote();
  }

  await waitFor(() => expect(notesFor(app, "/p").problem()).not.toBeNull());
  expect(screen.getByLabelText("Note", { selector: "textarea" })).toHaveProperty("value", "  in memory e\u0301\n🐝  ");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
  write.mockRestore();
});

it.each(["same", "older"])("p3557c_failure_lifetime_note_batch_submission: %s", async selected => {
  const { app } = await openDiff();
  await saveNote("  older submission 🐝  ");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "old refusal; retry"); };

  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await screen.findByText("old refusal; retry");
  await openBatch();
  fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
  await saveNote("  current submission e\u0301\n🐝  ");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "current refusal; retry"); };

  fireEvent.click(within(screen.getByLabelText("Agent notes", { selector: "section" })).getByRole("button", { name: /Send notes:|Retry/ }));
  await screen.findByText("current refusal; retry");
  startNote();
  fireEvent.input(screen.getByLabelText("Note", { selector: "textarea" }), { target: { value: "  unfinished e\u0301\n🐝  " } });
  fireEvent.click(screen.getByRole("button", { name: "Recover notes" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover notes" });
  fireEvent.click(within(recovery).getAllByRole("button", { name: "Discard this submission" })[selected === "same" ? 1 : 0]!);
  await waitFor(() => expect(notesFor(app, "/p").entries().find(([id]) => id === "a")?.[1].submissions).toHaveLength(1));

  if (selected === "same") await waitFor(() => expect(notesFor(app, "/p").failure("a")).toBeNull());
  fireEvent.click(within(recovery).getByRole("button", { name: "Close" }));
  startNote();
  expect(screen.queryByText("current refusal; retry") !== null).toBe(selected === "older");
  expect(screen.getByLabelText("Note", { selector: "textarea" })).toHaveProperty("value", "  unfinished e\u0301\n🐝  ");
  expect(app.calls.filter(call => call.method === "message.send").map(call => call.params)).toEqual([expect.objectContaining({ to: "a" }), expect.objectContaining({ to: "a" })]);
});

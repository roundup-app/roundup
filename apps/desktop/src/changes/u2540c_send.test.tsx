import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "@contracts/message/Message";
import { RpcError } from "../app/seam";
import { message } from "../testing/centreFixture";
import { COMPARISON, openDiff, openFile, saveNote } from "./noteHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("u2540c_one_message_contains_all_original_context", async () => {
  const { app } = await openDiff();
  await saveNote("  exact\ncomment <script>  ");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await openFile("src/deep/b.ts");
  await saveNote("second");
  let accepted: unknown;
  app.handlers["message.send"] = params => { accepted = JSON.parse(params.body);

 return message(1, { to: params.to, body: params.body }); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  expect(app.calls.find(call => call.method === "message.send")?.params).toMatchObject({ to: "a", kind: "note", replyTo: null });
  expect(accepted).toMatchObject({ notes: [
    { "File:": { old: "src/a.ts", new: "src/a.ts" }, "Base:": "base-commit", "Content revisions:": { old: "old-revision", new: "new-revision" }, "Lines:": "new 1-1", "Selected source:": "after", "User comment:": "  exact\ncomment <script>  " },
    { "File:": { new: "src/deep/b.ts" }, "User comment:": "second" },
  ] });
});

it("u2540c_empty_batch_sends_nothing", async () => {
  const { app } = await openDiff();
  expect(screen.queryByRole("button", { name: /Send notes to/ })).toBeNull();
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2540c_acceptance_clears_only_the_submitted_batch", async () => {
  const { app } = await openDiff();
  await saveNote("submitted");
  let resolve!: (value: Message) => void;
  app.handlers["message.send"] = () => new Promise(done => { resolve = done; });
  const send = screen.getByRole("button", { name: /Send notes to/ });
  fireEvent.click(send);
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  fireEvent.click(send);
  await saveNote("added meanwhile");
  resolve(message(1, { to: "a", status: "held" }));
  await waitFor(() => expect(screen.getByRole("list", { name: "Notes" }).textContent).not.toContain("submitted"));
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("added meanwhile");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Agent notes" }).textContent).toContain("held");
});

it("u2540c_rejection_and_unknown_acceptance_preserve_notes", async () => {
  const { app } = await openDiff();
  await saveNote("keep");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "receiver ended"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByText("receiver ended");
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("keep");
  let body = "";
  app.handlers["message.send"] = params => { body = params.body; throw new Error("disconnected"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByRole("button", { name: "Check Message history" });
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(2);
  app.handlers["message.list"] = () => [message(9, { from: { kind: "user", id: "you", parent: null }, to: "a", body, status: "pending" })];
  fireEvent.click(screen.getByRole("button", { name: "Check Message history" }));
  await waitFor(() => expect(screen.queryByRole("list", { name: "Notes" })).toBeNull());
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(2);
});


it.each(["failed", "acknowledged", "unknown"] as const)("u2773b_changes_settlement_preserves_other_revisions_%s", async outcome => {
  const { app, view } = await openDiff();
  await saveNote("  revision A 🐝\n e\u0301  ");
  let resolve!: (value: Message) => void;
  let reject!: (error: Error) => void;
  app.handlers["message.send"] = () => new Promise((done, fail) => { resolve = done; reject = fail; });
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  revision B 🐝\n newer  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  if (outcome === "acknowledged") resolve(message(1, { to: "a" }));
  else reject(outcome === "failed" ? new RpcError(-32003, "refused A") : new Error("lost reply A"));
  await waitFor(() => expect(screen.getByRole("button", { name: /Send notes to/ }).hasAttribute("disabled")).toBe(outcome === "unknown"));

  if (outcome === "failed") await screen.findByText("refused A");

  view.unmount();
  const reopened = await openDiff();
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("  revision B 🐝\n newer  ");
  expect(screen.getByRole("list", { name: "Notes" }).textContent).not.toContain("revision A");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);

  if (outcome === "acknowledged") {
    expect(screen.queryByRole("button", { name: "Recover Changes drafts" })).toBeNull();
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
    const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });

    expect(recovery.textContent).toContain("revision A");
    expect(recovery.textContent).toContain("revision B");
    expect(within(recovery).queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Discard this submission" }));
    expect(recovery.textContent).not.toContain("revision A");
    expect(recovery.textContent).toContain("revision B");
    reopened.view.unmount();
    await openDiff();
    expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("revision B");
  }
});

it("u2773b_changes_pending_reload_reconciles_without_resending", async () => {
  const { app, view } = await openDiff();
  await saveNote("acknowledged remotely");
  let body = "";
  let acknowledge!: (value: Message) => void;
  app.handlers["message.send"] = params => { body = params.body;

 return new Promise(done => { acknowledge = done; }); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  view.unmount();
  const reopened = await openDiff();
  reopened.app.handlers["message.list"] = () => [message(42, { body, to: "a", from: { kind: "user", id: "you", parent: null } })];
  expect(screen.getByRole("button", { name: /Send notes to/ }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check Message history" }));
  await waitFor(() => expect(screen.queryByRole("list", { name: "Notes" })).toBeNull());
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  acknowledge(message(42, { body, to: "a" }));
});


it("u2773b_changes_late_failure_stays_with_original_project", async () => {
  const { renderTabs, path, tab, projectTabs } = await import("../header/stripFixture");
  const { agent } = await import("../testing/nodes");
  const { WORKTREE, STATE } = await import("./harness");
  const { app } = renderTabs({ api: [agent("a", "working", "building", { worktree: WORKTREE })], web: [agent("b", "working", "building", { worktree: { ...WORKTREE, branch: "roundup/b" } })] });

  for (const name of ["api", "web"]) {
    const daemon = app.of(path(name));
    daemon.handlers["agent.worktreeState"] = () => STATE;
    daemon.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", status: "modified", line: 1 }] });
    daemon.handlers["agent.compareFile"] = () => COMPARISON;
  }

  await waitFor(() => expect(projectTabs().every(tab => tab.getAttribute("aria-busy") === "false")).toBe(true));
  fireEvent.click(tab("api"));
  fireEvent.click(await screen.findByText("a", { selector: ".name" }));
  fireEvent.click(await screen.findByRole("button", { name: "roundup/a" }));
  await openFile();
  await saveNote("submitted A");
  const original = app.of(path("api"));
  let refuse!: (error: Error) => void;
  original.handlers["message.send"] = () => new Promise((_done, reject) => { refuse = reject; });
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await waitFor(() => expect(original.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "newer A" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(tab("web"));
  fireEvent.click(await screen.findByText("b", { selector: ".name" }));
  fireEvent.click(await screen.findByRole("button", { name: "roundup/b" }));
  await openFile();
  await saveNote("Project B exact 🐝");
  refuse(new RpcError(-32003, "original Project refused"));
  fireEvent.click(tab("api"));
  fireEvent.click(await screen.findByRole("button", { name: "roundup/a" }));
  await screen.findByText("original Project refused");
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("newer A");
  expect(screen.getByRole("list", { name: "Notes" }).textContent).not.toContain("submitted A");
  fireEvent.click(tab("web"));
  fireEvent.click(await screen.findByRole("button", { name: "roundup/b" }));
  expect((await screen.findByRole("list", { name: "Notes" })).textContent).toContain("Project B exact 🐝");
  expect(app.of(path("web")).calls.filter(call => call.method === "message.send")).toHaveLength(0);
  expect(original.calls.filter(call => call.method === "message.send")).toHaveLength(1);
});


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

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByRole("button", { name: "Check Message history" });
  view.unmount();
  write?.mockRestore();
  const reopened = await openDiff();
  reopened.app.handlers["message.list"] = () => [message(42, { body, to: "a", from: { kind: "user", id: "you", parent: null } })];
  const retained = vi.spyOn(Storage.prototype, "setItem");
  fireEvent.click(screen.getByRole("button", { name: "Check Message history" }));
  // reconcile persists its settlement before returning; wait for that emitted boundary, not the request count.
  await waitFor(() => expect(retained.mock.calls.some(([key]) => key === "roundup:drafts:/p")).toBe(true));
  expect(screen.getByRole("button", { name: /Send notes to/ }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("exact possibly accepted note");
  expect(reopened.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it("u2773b_changes_reconnect_failure_preserves_newer_revision", async () => {
  const first = await openDiff();
  await saveNote("older connection revision A");
  let refuse!: (error: Error) => void;
  first.app.handlers["message.send"] = () => new Promise((_done, reject) => { refuse = reject; });
  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await waitFor(() => expect(first.app.calls.filter(call => call.method === "message.send")).toHaveLength(1));
  first.view.unmount();
  const next = await openDiff("/p", first.connected.drafts);
  fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "new connection revision B 🐝" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  refuse(new RpcError(-32003, "original connection refused"));
  await screen.findByText("original connection refused");
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("new connection revision B 🐝");
  expect(next.app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  expect(recovery.textContent).toContain("older connection revision A");
  expect(recovery.textContent).toContain("new connection revision B 🐝");
  next.view.unmount();
  await openDiff("/p", first.connected.drafts);
  expect(screen.getByRole("list", { name: "Notes" }).textContent).toContain("new connection revision B 🐝");
});

it.each(["remove", "save", "dismiss", "other remove", "other save", "cancel edit"])("p3557c_failure_lifetime_note_batch: %s", async action => {
  const { app } = await openDiff();
  const exact = "  original e\u0301\n🐝  ";
  await saveNote(exact);
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "recipient refused; edit or retry notes"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByText("recipient refused; edit or retry notes");
  await saveNote("  unrelated 🐝\n exact  ");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  const field = screen.getByRole("textbox", { name: "Note" });
  fireEvent.input(field, { target: { value: "  unfinished e\u0301\n🐝  " } });

  if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  else if (action.endsWith("remove")) fireEvent.click(screen.getByRole("button", { name: action === "remove" ? "Remove note 1" : "Remove note 2" }));
  else {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: action === "other save" ? "Edit note 2" : "Edit note 1" }));

    if (action === "cancel edit") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    else {
      fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  acknowledged replacement 🐝  " } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  }

  expect(screen.queryByText("recipient refused; edit or retry notes") !== null).toBe(action.startsWith("other") || action === "cancel edit");
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  unfinished e\u0301\n🐝  ");
  const list = screen.getByRole("list", { name: "Notes" });
  expect(list.textContent).toContain(action === "other save" ? "  acknowledged replacement 🐝  " : action === "other remove" ? exact : "  unrelated 🐝\n exact  ");
  expect(app.calls.filter(call => call.method === "message.send").map(call => call.params)).toEqual([expect.objectContaining({ to: "a", body: expect.stringContaining(exact.replaceAll("\n", "\\n")) })]);
});

it.each(["remove", "save", "dismiss"])("p3557c_failure_lifetime_note_batch_load: %s", async action => {
  const { app } = await openDiff();
  await saveNote("  original note e\u0301\n🐝  ");
  app.handlers["message.list"] = () => { throw new RpcError(-32003, "history refused; retry loading history"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByText("history refused; retry loading history");

  if (action === "remove") fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
  else if (action === "save") {
    fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
    fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  revised 🐝  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  } else fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText("history refused; retry loading history") !== null).toBe(action !== "dismiss");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(0);
});

it.each(["dismiss", "remove", "save"])("p3557c_failure_lifetime_note_batch_retention: %s", async action => {
  const { app } = await openDiff();
  await saveNote("  original note e\u0301\n🐝  ");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "recipient refused; retry"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByText("recipient refused; retry");
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk refused"); });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  in memory e\u0301\n🐝  " } });

  if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  else if (action === "remove") fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
  else {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit note 1" }));
    fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  cannot retain save 🐝  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  }

  expect(screen.getByRole("alert").textContent).toContain("storage refused a write");
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  in memory e\u0301\n🐝  ");
  expect(app.calls.filter(call => call.method === "message.send")).toHaveLength(1);
  write.mockRestore();
});

it.each(["same", "older"])("p3557c_failure_lifetime_note_batch_submission: %s", async selected => {
  const { app } = await openDiff();
  await saveNote("  older submission 🐝  ");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "old refusal; retry"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByText("old refusal; retry");
  fireEvent.click(screen.getByRole("button", { name: "Remove note 1" }));
  await saveNote("  current submission e\u0301\n🐝  ");
  app.handlers["message.send"] = () => { throw new RpcError(-32003, "current refusal; retry"); };

  fireEvent.click(screen.getByRole("button", { name: /Send notes to/ }));
  await screen.findByText("current refusal; retry");
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Note" }), { target: { value: "  unfinished e\u0301\n🐝  " } });
  fireEvent.click(screen.getByRole("button", { name: "Recover Changes drafts" }));
  const recovery = await screen.findByRole("dialog", { name: "Recover Changes drafts" });
  fireEvent.click(within(recovery).getAllByRole("button", { name: "Discard this submission" })[selected === "same" ? 1 : 0]!);
  fireEvent.click(within(recovery).getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await openFile();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.queryByText("current refusal; retry") !== null).toBe(selected === "older");
  expect(screen.getByRole("textbox", { name: "Note" })).toHaveProperty("value", "  unfinished e\u0301\n🐝  ");
  expect(app.calls.filter(call => call.method === "message.send").map(call => call.params)).toEqual([expect.objectContaining({ to: "a" }), expect.objectContaining({ to: "a" })]);
});

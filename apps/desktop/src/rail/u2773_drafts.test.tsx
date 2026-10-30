import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";
import { copy } from "../drawer/copy";
import { ConnectedProjectContext } from "../state/connectedProject";

afterEach(() => { cleanup(); localStorage.clear(); });

const open = () => fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });

const field = () => screen.getByLabelText<HTMLTextAreaElement>("Task");

it.each(["acknowledged", "failed", "unknown", "transport"])("u2773b_rail_settlement_preserves_other_revisions_%s", async (outcome) => {
  const { RpcError } = await import("../app/seam");
  const mounted = await mountRail([workstream("w")]);
  let resolve!: (value: ReturnType<typeof workstream>) => void;
  let reject!: (error: Error) => void;
  mounted.app.handlers["agent.spawn"] = () => new Promise((yes, no) => { resolve = yes; reject = no; });
  open();
  fireEvent.input(field(), { target: { value: " A\n😀 " } });
  fireEvent.keyDown(field(), { key: "Enter" });
  fireEvent.input(field(), { target: { value: " B\ne\u0301 " } });
  await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1));

  if (outcome === "acknowledged") resolve(workstream("spawned"));
  else reject(outcome === "failed" ? new RpcError(-32003, "refused") : outcome === "transport" ? new RpcError(-32603, "connection lost") : new Error("disconnected"));
  await waitFor(() => expect(mounted.connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(field().value).toBe(" B\ne\u0301 ");
  const revisions = screen.queryAllByLabelText<HTMLTextAreaElement>(copy.unfinishedWork);
  expect(revisions.map((entry) => entry.value)).toEqual(outcome === "acknowledged" ? [] : [" A\n😀 "]);
  expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1);

  if (outcome !== "acknowledged") {
    expect(mounted.connected.drafts.list().find(draft => draft.status === (outcome === "failed" ? "failed" : "unknown"))?.value.text).toBe(" A\n😀 ");
    fireEvent.click(screen.getAllByRole("button", { name: copy.discardRow, hidden: true })[0]!);
  }

  cleanup();
  const reopened = await mountRail([workstream("w")]);
  open();
  expect(field().value).toBe(" B\ne\u0301 ");
  expect(railCallsTo(reopened.app, "agent.spawn")).toEqual([]);
});

it("u2773e_recovery_actions_keep_surface_draft", async () => {
  const { vi } = await import("vitest");
  const mounted = await mountRail([workstream("w")]);
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });

  try {
    open();
    fireEvent.input(field(), { target: { value: " memory\n😀 " } });
    await screen.findByRole("button", { name: "Retry storage" });
    expect(field().value).toBe(" memory\n😀 ");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.getByLabelText<HTMLTextAreaElement>(copy.unfinishedWork).value).toBe(" memory\n😀 ");
    open();
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry storage" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(field().value).toBe(" memory\n😀 ");
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
    cleanup();
    await mountRail([workstream("w")]);
    open();
    expect(field().value).toBe(" memory\n😀 ");
  } finally { writes.mockRestore(); }
});

it("u2773a_rail_task_keeps_original_recipient_after_selection_changes", async () => {
  const { door } = await import("../testing/nodes");
  const mounted = await mountRail([door("a", "idle", "idle"), door("b", "idle", "idle")]);
  const { message } = await import("../testing/centreFixture");
  mounted.app.handlers["message.send"] = () => message(1);
  mounted.rail.select("a");
  open();
  fireEvent.input(field(), { target: { value: " exact\n😀 " } });
  mounted.rail.select("b");
  fireEvent.keyDown(field(), { key: "Enter" });
  await waitFor(() => expect(railCallsTo(mounted.app, "message.send")).toHaveLength(1));
  expect(railCallsTo(mounted.app, "message.send")).toEqual([{ to: "a", kind: "note", body: "exact\n😀", replyTo: null }]);
  expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
});


it("u2773b_rail_late_failure_stays_in_original_project", async () => {
  const { render } = await import("@solidjs/testing-library");
  const { RpcError } = await import("../app/seam");
  const { createFakeApp } = await import("../testing/fakeApp");
  const { connectProject, ConnectedProjectContext } = await import("../state/connectedProject");
  const { Rail } = await import("./Rail");
  const original = await mountRail([workstream("w")]);
  let refuse!: (error: Error) => void;
  original.app.handlers["agent.spawn"] = () => new Promise((_, reject) => { refuse = reject; });
  open();
  fireEvent.input(field(), { target: { value: " A\n😀 " } });
  fireEvent.keyDown(field(), { key: "Enter" });
  cleanup();
  const other = createFakeApp();
  other.handlers["rail.tree"] = () => [workstream("other")];
  const connection = await connectProject(other, { name: "Other", path: "/other" }, () => true, Date.now);
  render(() => <ConnectedProjectContext.Provider value={connection}><Rail /></ConnectedProjectContext.Provider>);
  open();
  fireEvent.input(field(), { target: { value: " B\ne\u0301 " } });
  refuse(new RpcError(-32003, "refused original"));
  await waitFor(() => expect(original.connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(field().value).toBe(" B\ne\u0301 ");
  expect(railCallsTo(other, "agent.spawn")).toEqual([]);
  cleanup();
  await mountRail([workstream("w")]);
  open();
  expect(field().value).toBe(" A\n😀 ");
  fireEvent.keyDown(field(), { key: "Escape" });
  expect(original.connected.drafts.list().at(-1)?.status).toBe("failed");
  expect(railCallsTo(original.app, "agent.spawn")).toHaveLength(1);
});

it.each(["failed", "acknowledged", "unknown", "transport"])("u2773b_rail_name_settlement_keeps_newer_edit_%s", async (outcome) => {
  const { agent } = await import("../testing/nodes");
  const { RpcError } = await import("../app/seam");
  const mounted = await mountRail([agent("a", "idle", "ready", { name: "Original" })]);
  let accept!: (node: ReturnType<typeof agent>) => void;
  let refuse!: (error: Error) => void;
  mounted.app.handlers["rail.rename"] = () => new Promise((resolve, reject) => { accept = resolve; refuse = reject; });
  fireEvent.dblClick(screen.getByText("Original"));
  const name = screen.getByLabelText<HTMLInputElement>("Name");
  fireEvent.input(name, { target: { value: " A e\u0301 😀 " } });
  fireEvent.keyDown(name, { key: "Enter" });
  fireEvent.input(name, { target: { value: " B 😀 " } });
  await waitFor(() => expect(accept).toBeTypeOf("function"));

  if (outcome === "acknowledged") accept(agent("a", "idle", "ready", { name: "A e\u0301 😀" }));
  else refuse(outcome === "failed" ? new RpcError(-32003, "refused") : outcome === "transport" ? new RpcError(-32603, "connection lost") : new Error("disconnected"));
  await waitFor(() => expect(mounted.connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(name.value).toBe(" B 😀 ");
  expect(screen.queryAllByLabelText<HTMLTextAreaElement>(copy.unfinishedWork).map((field) => field.value)).toEqual(outcome === "acknowledged" ? [] : [" A e\u0301 😀 "]);
  expect(railCallsTo(mounted.app, "rail.rename")).toEqual([{ id: "a", name: "A e\u0301 😀" }]);
  cleanup();
  const reopened = await mountRail([agent("a", "idle", "ready", { name: "Original" })]);
  fireEvent.dblClick(screen.getByText("Original"));
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(" B 😀 ");
  expect(railCallsTo(reopened.app, "rail.rename")).toEqual([]);
});



it("u2773b_rail_out_of_order_name_replies_keep_new_work", async () => {
  const { agent } = await import("../testing/nodes");
  const { RpcError } = await import("../app/seam");
  const { waitFor } = await import("@solidjs/testing-library");
  const mounted = await mountRail([agent("a", "idle", "ready", { name: "Original" })]);
  let refuseA!: (error: Error) => void;
  let acceptB!: (node: ReturnType<typeof agent>) => void;
  let calls = 0;
  mounted.app.handlers["rail.rename"] = () => ++calls === 1
    ? new Promise((_, reject) => { refuseA = reject; })
    : new Promise((resolve) => { acceptB = resolve; });
  fireEvent.dblClick(screen.getByText("Original"));
  const name = screen.getByLabelText<HTMLInputElement>("Name");
  fireEvent.input(name, { target: { value: " A 😀 " } });
  fireEvent.keyDown(name, { key: "Enter" });
  fireEvent.input(name, { target: { value: " B 😀 " } });
  fireEvent.keyDown(name, { key: "Enter" });
  await waitFor(() => expect(acceptB).toBeTypeOf("function"));
  acceptB(agent("a", "idle", "ready", { name: "B 😀" }));
  await waitFor(() => expect(name.isConnected).toBe(false));
  fireEvent.dblClick(screen.getByText("Original"));
  const newer = screen.getByLabelText<HTMLInputElement>("Name");
  fireEvent.input(newer, { target: { value: " C e\u0301 😀 " } });
  const failure = new RpcError(-32003, "older name refused");
  refuseA(failure);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(failure.message));
  expect(newer.value).toBe(" C e\u0301 😀 ");
  expect(screen.getAllByLabelText<HTMLTextAreaElement>(copy.unfinishedWork).map((entry) => entry.value)).toEqual([" A 😀 "]);
  expect(railCallsTo(mounted.app, "rail.rename")).toEqual([{ id: "a", name: "A 😀" }, { id: "a", name: "B 😀" }]);
});

it("u2773a_rail_recovery_keeps_selection_when_submission_settles", async () => {
  const { RpcError } = await import("../app/seam");
  const { copy } = await import("./copy");
  const { waitFor } = await import("@solidjs/testing-library");
  const mounted = await mountRail([workstream("w")]);
  let refuse!: (error: Error) => void;
  mounted.app.handlers["agent.spawn"] = () => new Promise((_, reject) => { refuse = reject; });
  open();
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.input(field(), { target: { value: " A\n😀 " } });
  fireEvent.keyDown(field(), { key: "Enter" });
  fireEvent.input(field(), { target: { value: " B\ne\u0301 " } });
  const older = screen.getAllByLabelText<HTMLTextAreaElement>(copy.railDraftRecovered).find((entry) => entry.value === " A\n😀 ")!;
  fireEvent.click(older.closest(".rail-recovery")!.querySelector("summary")!);
  fireEvent.click(older.closest("details")!.querySelector("summary")!);
  older.focus();
  older.setSelectionRange(2, 5, "backward");
  await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1));
  const failure = new RpcError(-32003, "original refused");
  refuse(failure);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(failure.message));
  expect(document.activeElement).toBe(older);
  expect([older.selectionStart, older.selectionEnd, older.selectionDirection]).toEqual([2, 5, "backward"]);
  expect(field().value).toBe(" B\ne\u0301 ");
  expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1);
});




it("u2773b_rail_recovery_shares_project_revisions_without_duplicate_entry", async () => {
  const { connected, app } = await mountRail([workstream("w")]);
  render(() => <ConnectedProjectContext.Provider value={connected}><span /></ConnectedProjectContext.Provider>);
  open();
  fireEvent.input(field(), { target: { value: " exact\n😀 " } });
  fireEvent.keyDown(field(), { key: "Escape" });
  const revision = connected.drafts.list()[0]!;
  expect(revision.value.text).toBe(" exact\n😀 ");
  expect(connected.drafts.list()).toHaveLength(1);
  connected.drafts.discard(revision.revision);
  expect(screen.queryAllByRole("textbox", { hidden: true })).toEqual([]);
  open();
  fireEvent.input(field(), { target: { value: "new work" } });
  fireEvent.keyDown(field(), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: copy.discardRow, hidden: true }));
  expect(connected.drafts.list()).toEqual([]);
  expect(connected.drafts.problem()).toBeNull();
  expect(railCallsTo(app, "agent.spawn")).toEqual([]);
  cleanup();
  await mountRail([workstream("w")]);
  open();
  expect(field().value).toBe("");
});

it.each([null, "a"])("u471_action_labels_describe_the_existing_action_recovery_%s", async parent => {
  const { openTabs, tab, path } = await import("../header/stripFixture");
  const { agent, door } = await import("../testing/nodes");
  const { message } = await import("../testing/centreFixture");
  const { app } = await openTabs({ Orchard: [door("a", "idle", "ready", { name: "Review" })], Other: [] });
  fireEvent.click(tab("Orchard"));
  const { rowOf } = await import("./railFixture");
  await waitFor(() => expect(rowOf("Review")).toBeTruthy());

  if (parent) {
    fireEvent.click(rowOf("Review"));
    await waitFor(() => expect(rowOf("Review").dataset.selected).toBe("true"));
  }

  const original = app.of(path("Orchard"));
  original.handlers["message.send"] = () => message(1);
  original.handlers["agent.spawn"] = () => agent("new", "working", "starting");
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });

  try {
    open();
    fireEvent.input(field(), { target: { value: "exact draft e\u0301\n🧭" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    fireEvent.click(tab("Other"));
    await waitFor(() => expect(tab("Other").getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(tab("Orchard"));
    const copied: string[] = [];
    vi.spyOn(app, "clipboardWrite").mockImplementation(async (text: string) => { copied.push(text); });
    fireEvent.click(await screen.findByRole("button", { name: copy.copyDraft, hidden: true }));
    await waitFor(() => expect(copied).toEqual(["exact draft e\u0301\n🧭"]));
    expect(original.calls.filter(call => call.method === "agent.spawn" || call.method === "message.send")).toEqual([]);
    writes.mockRestore();
    open();
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(original.calls.filter(call => call.method === (parent ? "message.send" : "agent.spawn"))).toHaveLength(1));
    const call = original.calls.find(call => call.method === (parent ? "message.send" : "agent.spawn"))!;
    expect(call.params).toMatchObject(parent ? { to: "a", body: "exact draft e\u0301\n🧭" } : { cwd: path("Orchard"), parent: null, prompt: "exact draft e\u0301\n🧭" });
    expect(app.of(path("Other")).calls.filter(call => call.method === "agent.spawn" || call.method === "message.send")).toEqual([]);
  } finally { writes.mockRestore(); }
});

it("u350_retired_clear_drafts_do_not_reopen_or_send", async () => {
  const { door } = await import("../testing/nodes");
  const key = "roundup:drafts:/p";
  const text = " exact\ne\u0301 😀 ";
  const selection = { start: 2, end: 5, direction: "backward" };

  const task = { revision: "task", destination: { surface: "rail-task", object: "a", recipient: "a" },
    value: { text, parent: "a", action: "note", model: null, effort: null }, selection, status: "draft", policy: "ordinary" };

  localStorage.setItem(key, JSON.stringify({ version: 1, drafts: [
    { ...task, revision: "clear", destination: { surface: "rail-clear", object: "a", recipient: "a" }, value: { text: "retired reason", withoutHandoff: true } }, task,
  ] }));
  const first = await mountRail([door("a", "idle", "ready"), door("b", "idle", "ready")]);
  expect(first.connected.drafts.list()).toEqual([task]);
  await waitFor(() => expect(JSON.parse(localStorage.getItem(key)!).drafts).toEqual([task]));
  cleanup();
  const reopened = await mountRail([door("a", "idle", "ready"), door("b", "idle", "ready")]);
  reopened.rail.select("b");
  open();
  await waitFor(() => expect(document.activeElement).toBe(field()));
  expect(field().value).toBe(text);
  expect([field().selectionStart, field().selectionEnd, field().selectionDirection]).toEqual([2, 5, "backward"]);
  expect(reopened.connected.drafts.list()).toEqual([task]);
  expect(screen.queryByRole("textbox", { name: /Why clear/ })).toBeNull();
  expect(reopened.app.calls.filter(call => ["workstream.clear", "message.send", "agent.spawn"].includes(call.method))).toEqual([]);
});

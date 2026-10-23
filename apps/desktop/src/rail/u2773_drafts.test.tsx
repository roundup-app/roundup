import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";
import { ConnectedProjectContext } from "../state/connectedProject";

afterEach(() => { cleanup(); localStorage.clear(); });

const open = () => fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });

const field = () => screen.getByLabelText<HTMLTextAreaElement>("Task");

it.each(["unknown"])("u2773b_rail_settlement_preserves_other_revisions_%s", async (outcome) => {
  const { RpcError } = await import("../app/seam");
  const mounted = await mountRail([workstream("w")]);
  let resolve!: (value: ReturnType<typeof workstream>) => void;
  let reject!: (error: Error) => void;
  mounted.app.handlers["agent.spawn"] = () => new Promise((yes, no) => { resolve = yes; reject = no; });
  open();
  fireEvent.input(field(), { target: { value: " A\n😀 " } });
  fireEvent.keyDown(field(), { key: "Enter" });
  fireEvent.input(field(), { target: { value: " B\ne\u0301 " } });

  if (outcome === "acknowledged") resolve(workstream("spawned"));
  else reject(outcome === "failed" ? new RpcError(-32003, "refused") : outcome === "transport" ? new RpcError(-32603, "connection lost") : new Error("disconnected"));
  await new Promise((done) => setTimeout(done));
  expect(field().value).toBe(" B\ne\u0301 ");
  const revisions = screen.queryAllByLabelText<HTMLTextAreaElement>("Recovered rail draft");
  expect(revisions.map((entry) => entry.value)).toEqual(outcome === "acknowledged" ? [] : [" A\n😀 "]);
  expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1);

  if (outcome !== "acknowledged") {
    expect(document.body.textContent).toContain("Completion unconfirmed");
    fireEvent.click(screen.getAllByRole("button", { name: "Discard this revision", hidden: true })[0]!);
  }

  cleanup();
  const reopened = await mountRail([workstream("w")]);
  open();
  expect(field().value).toBe(" B\ne\u0301 ");
  expect(railCallsTo(reopened.app, "agent.spawn")).toEqual([]);
});

it("u2773e_recovery_actions_keep_surface_draft", async () => {
  const { vi } = await import("vitest");
  const mounted = await mountRail([]);
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  open();
  fireEvent.input(field(), { target: { value: " memory\n😀 " } });
  expect(field().value).toBe(" memory\n😀 ");
  expect(screen.queryByText("Unfinished rail work")).toBeNull();
  fireEvent.keyDown(field(), { key: "Escape" });
  expect(screen.getByLabelText<HTMLTextAreaElement>("Recovered rail draft").value).toBe(" memory\n😀 ");
  open();
  expect(screen.queryByText("Unfinished rail work")).toBeNull();
  writes.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Retry storage" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(field().value).toBe(" memory\n😀 ");
  expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  cleanup();
  await mountRail([]);
  open();
  expect(field().value).toBe(" memory\n😀 ");
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
  await new Promise((done) => setTimeout(done));
  expect(railCallsTo(mounted.app, "message.send")).toEqual([{ to: "a", kind: "note", body: "exact\n😀", replyTo: null }]);
  expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
});

it("u2773a_rail_clear_restores_exact_reason_and_selection", async () => {
  const { vi } = await import("vitest");
  const { door } = await import("../testing/nodes");
  const { rowOf } = await import("./railFixture");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

  const reopen = async (app: { pickMenu: (label: string) => Promise<void> }) => {
    fireEvent.contextMenu(rowOf("ws"), { clientX: 10, clientY: 10 });
    await app.pickMenu("Clear…");
  };

  const reason = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Why clear/ });

  try {
    const first = await mountRail([door("w", "idle", "idle", { name: "ws" })]);
    await reopen(first.app);
    fireEvent.input(reason(), { target: { value: " exact\ne\u0301 😀 " } });
    reason().setSelectionRange(2, 5, "backward");
    fireEvent.select(reason());
    fireEvent.keyDown(reason(), { key: "Escape" });
    cleanup();
    const mounted = await mountRail([door("w", "idle", "idle", { name: "ws" })]);
    await reopen(mounted.app);
    await Promise.resolve();
    expect(reason().value).toBe(" exact\ne\u0301 😀 ");
    expect([reason().selectionStart, reason().selectionEnd, reason().selectionDirection]).toEqual([2, 5, "backward"]);
    expect(railCallsTo(mounted.app, "workstream.clear")).toEqual([]);
    expect(document.activeElement).toBe(reason());
  } finally { vi.unstubAllGlobals(); }
});

it("u2773b_rail_late_failure_stays_in_original_project", async () => {
  const { render } = await import("@solidjs/testing-library");
  const { RpcError } = await import("../app/seam");
  const { createFakeApp } = await import("../testing/fakeApp");
  const { connectProject, ConnectedProjectContext } = await import("../state/connectedProject");
  const { Rail } = await import("./Rail");
  const original = await mountRail([]);
  let refuse!: (error: Error) => void;
  original.app.handlers["agent.spawn"] = () => new Promise((_, reject) => { refuse = reject; });
  open();
  fireEvent.input(field(), { target: { value: " A\n😀 " } });
  fireEvent.keyDown(field(), { key: "Enter" });
  cleanup();
  const other = createFakeApp();
  const connection = await connectProject(other, { name: "Other", path: "/other" }, () => true, Date.now);
  render(() => <ConnectedProjectContext.Provider value={connection}><Rail /></ConnectedProjectContext.Provider>);
  open();
  fireEvent.input(field(), { target: { value: " B\ne\u0301 " } });
  refuse(new RpcError(-32003, "refused original"));
  await new Promise((done) => setTimeout(done));
  expect(field().value).toBe(" B\ne\u0301 ");
  expect(railCallsTo(other, "agent.spawn")).toEqual([]);
  cleanup();
  await mountRail([]);
  open();
  expect(field().value).toBe(" A\n😀 ");
  fireEvent.keyDown(field(), { key: "Escape" });
  expect(document.body.textContent).toContain("Not submitted");
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

  if (outcome === "acknowledged") accept(agent("a", "idle", "ready", { name: "A e\u0301 😀" }));
  else refuse(outcome === "failed" ? new RpcError(-32003, "refused") : outcome === "transport" ? new RpcError(-32603, "connection lost") : new Error("disconnected"));
  await new Promise((done) => setTimeout(done));
  expect(name.value).toBe(" B 😀 ");
  expect(screen.queryAllByLabelText<HTMLTextAreaElement>("Recovered rail draft").map((field) => field.value)).toEqual(outcome === "acknowledged" ? [] : [" A e\u0301 😀 "]);
  expect(railCallsTo(mounted.app, "rail.rename")).toEqual([{ id: "a", name: "A e\u0301 😀" }]);
  cleanup();
  const reopened = await mountRail([agent("a", "idle", "ready", { name: "Original" })]);
  fireEvent.dblClick(screen.getByText("Original"));
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(" B 😀 ");
  expect(railCallsTo(reopened.app, "rail.rename")).toEqual([]);
});

it("u2773a_rail_clear_failure_does_not_take_focus", async () => {
  const { vi } = await import("vitest");
  const { door, event } = await import("../testing/nodes");
  const { rowOf, pinnedAdd } = await import("./railFixture");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

  try {
    const mounted = await mountRail([door("w", "idle", "idle", { name: "ws" })]);
    mounted.app.handlers["workstream.clear"] = () => ({ pending: true });
    fireEvent.contextMenu(rowOf("ws"), { clientX: 10, clientY: 10 });
    await mounted.app.pickMenu("Clear…");
    const reason = screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Why clear/ });
    await Promise.resolve();
    fireEvent.input(reason, { target: { value: " exact 😀 " } });
    fireEvent.submit(reason.closest("form")!);
    const elsewhere = pinnedAdd();
    elsewhere.focus();
    mounted.app.emit(event({ name: "workstream.clearFailed", data: { id: "w", code: -32008, message: "not acknowledged" } }));
    await new Promise((done) => setTimeout(done));
    expect(document.activeElement).toBe(elsewhere);
    expect(reason.value).toBe(" exact 😀 ");
    expect(railCallsTo(mounted.app, "workstream.clear")).toHaveLength(1);
  } finally { vi.unstubAllGlobals(); }
});

it("u2773a_rail_clear_reopens_on_same_project_connection", async () => {
  const { render } = await import("@solidjs/testing-library");
  const { vi } = await import("vitest");
  const { door } = await import("../testing/nodes");
  const { rowOf } = await import("./railFixture");
  const { ConnectedProjectContext } = await import("../state/connectedProject");
  const { Rail } = await import("./Rail");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

  const reopen = async (app: { pickMenu: (label: string) => Promise<void> }) => {
    fireEvent.contextMenu(rowOf("ws"), { clientX: 10, clientY: 10 });
    await app.pickMenu("Clear…");
  };

  try {
    const mounted = await mountRail([door("w", "idle", "idle", { name: "ws" })]);
    await reopen(mounted.app);
    fireEvent.input(screen.getByRole("textbox", { name: /Why clear/ }), { target: { value: " exact\n😀 " } });
    cleanup();
    render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Rail /></ConnectedProjectContext.Provider>);
    await reopen(mounted.app);
    await Promise.resolve();
    const reason = screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Why clear/ });
    expect(reason.value).toBe(" exact\n😀 ");
    expect(document.activeElement).toBe(reason);
    expect(railCallsTo(mounted.app, "workstream.clear")).toEqual([]);
  } finally { vi.unstubAllGlobals(); }
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
  acceptB(agent("a", "idle", "ready", { name: "B 😀" }));
  await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
  fireEvent.dblClick(screen.getByText("Original"));
  const newer = screen.getByLabelText<HTMLInputElement>("Name");
  fireEvent.input(newer, { target: { value: " C e\u0301 😀 " } });
  refuseA(new RpcError(-32003, "older name refused"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("older name refused"));
  expect(newer.value).toBe(" C e\u0301 😀 ");
  expect(screen.getAllByLabelText<HTMLTextAreaElement>("Recovered rail draft").map((entry) => entry.value)).toEqual([" A 😀 "]);
  expect(railCallsTo(mounted.app, "rail.rename")).toEqual([{ id: "a", name: "A 😀" }, { id: "a", name: "B 😀" }]);
});

it("u2773a_rail_recovery_keeps_selection_when_submission_settles", async () => {
  const { RpcError } = await import("../app/seam");
  const { copy } = await import("../copy");
  const { waitFor } = await import("@solidjs/testing-library");
  const mounted = await mountRail([]);
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
  refuse(new RpcError(-32003, "original refused"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("original refused"));
  expect(document.activeElement).toBe(older);
  expect([older.selectionStart, older.selectionEnd, older.selectionDirection]).toEqual([2, 5, "backward"]);
  expect(field().value).toBe(" B\ne\u0301 ");
  expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1);
});

it("u2773b_rail_unknown_clear_reopens_without_retry", async () => {
  const { vi } = await import("vitest");
  const { RpcError } = await import("../app/seam");
  const { door } = await import("../testing/nodes");
  const { rowOf } = await import("./railFixture");
  const { waitFor } = await import("@solidjs/testing-library");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

  const reopen = async (app: { pickMenu: (label: string) => Promise<void> }) => {
    fireEvent.contextMenu(rowOf("ws"), { clientX: 10, clientY: 10 });
    await app.pickMenu("Clear…");
  };

  const reason = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Why clear/ });
  const submit = () => screen.getByRole<HTMLButtonElement>("button", { name: "Clear and keep a summary" });

  try {
    const mounted = await mountRail([door("w", "idle", "idle", { name: "ws" })]);
    mounted.app.handlers["workstream.clear"] = () => { throw new RpcError(-32603, "connection lost"); };

    await reopen(mounted.app);
    fireEvent.input(reason(), { target: { value: " A\n😀 " } });
    fireEvent.submit(reason().closest("form")!);
    await screen.findByText("connection lost");
    await waitFor(() => expect(submit().disabled).toBe(true));
    fireEvent.keyDown(reason(), { key: "Escape" });
    await reopen(mounted.app);
    await waitFor(() => expect(document.activeElement).toBe(reason()));
    expect(reason().value).toBe(" A\n😀 ");
    expect(submit().disabled).toBe(true);
    fireEvent.submit(reason().closest("form")!);
    expect(railCallsTo(mounted.app, "workstream.clear")).toHaveLength(1);
    fireEvent.input(reason(), { target: { value: " B\ne\u0301 " } });
    expect(submit().disabled).toBe(false);
    expect(screen.getAllByLabelText<HTMLTextAreaElement>("Recovered rail draft").map((entry) => entry.value)).toEqual([" A\n😀 "]);
    expect(railCallsTo(mounted.app, "workstream.clear")).toHaveLength(1);
  } finally { vi.unstubAllGlobals(); }
});

it("u2773a_rail_pending_clear_hides_without_discard_or_retry", async () => {
  const { vi } = await import("vitest");
  const { door, event } = await import("../testing/nodes");
  const { rowOf } = await import("./railFixture");
  const { waitFor } = await import("@solidjs/testing-library");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

  const reopen = async (app: { pickMenu: (label: string) => Promise<void> }) => {
    fireEvent.contextMenu(rowOf("ws"), { clientX: 10, clientY: 10 });
    await app.pickMenu("Clear…");
  };

  try {
    const mounted = await mountRail([door("w", "idle", "idle", { name: "ws" })]);
    mounted.app.handlers["workstream.clear"] = () => ({ pending: true });
    await reopen(mounted.app);
    const reason = screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Why clear/ });
    await waitFor(() => expect(document.activeElement).toBe(reason));
    fireEvent.input(reason, { target: { value: " exact\ne\u0301 😀 " } });
    fireEvent.submit(reason.closest("form")!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Clear ws" })).toBeNull();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Recovered rail draft").value).toBe(" exact\ne\u0301 😀 ");
    mounted.app.emit(event({ name: "workstream.clearFailed", data: { id: "w", code: -32008, message: "not acknowledged" } }));
    await reopen(mounted.app);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Why clear/ }).value).toBe(" exact\ne\u0301 😀 ");
    expect(railCallsTo(mounted.app, "workstream.clear")).toHaveLength(1);
  } finally { vi.unstubAllGlobals(); }
});


it("u2773b_rail_recovery_shares_project_revisions_without_duplicate_entry", async () => {
  const { connected, app } = await mountRail([]);
  render(() => <ConnectedProjectContext.Provider value={connected}><span /></ConnectedProjectContext.Provider>);
  open();
  fireEvent.input(field(), { target: { value: " exact\n😀 " } });
  fireEvent.keyDown(field(), { key: "Escape" });
  const revision = connected.drafts.list()[0]!;
  expect(revision.value.text).toBe(" exact\n😀 ");
  expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();
  connected.drafts.discard(revision.revision);
  expect(screen.queryByLabelText("Recovered rail draft")).toBeNull();
  open();
  fireEvent.input(field(), { target: { value: "new work" } });
  fireEvent.keyDown(field(), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Discard this revision", hidden: true }));
  expect(connected.drafts.list()).toEqual([]);
  expect(connected.drafts.problem()).toBeNull();
  expect(railCallsTo(app, "agent.spawn")).toEqual([]);
  cleanup();
  await mountRail([]);
  open();
  expect(field().value).toBe("");
});

it.each([null, "a"])("u3299c_retention_preserves_original_work_rail_%s", async parent => {
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
    fireEvent.click(await screen.findByRole("button", { name: "Copy draft", hidden: true }));
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

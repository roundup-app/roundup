import { RpcError } from "../app/seam";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";
import { clearingOf } from "./clear";
import { ClearPrompt } from "./ClearPrompt";
import { ConnectedProjectContext } from "../state/connectedProject";
import { render } from "@solidjs/testing-library";

afterEach(() => { cleanup(); localStorage.clear(); });

const open = () => fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });

const field = () => screen.getByLabelText<HTMLTextAreaElement>("Task");

it("u2773a_rail_restores_exact_work", async () => {
  const first = await mountRail([workstream("w")]);
  open();
  fireEvent.input(field(), { target: { value: " exact\ne\u0301 😀 " } });
  field().setSelectionRange(2, 5, "backward");
  fireEvent.select(field());
  fireEvent.keyDown(field(), { key: "Escape" });
  cleanup();
  const reopened = await mountRail([workstream("w")]);
  open();
  await Promise.resolve();
  expect(field().value).toBe(" exact\ne\u0301 😀 ");
  expect([field().selectionStart, field().selectionEnd, field().selectionDirection]).toEqual([2, 5, "backward"]);
  expect(railCallsTo(first.app, "agent.spawn")).toEqual([]);
  expect(railCallsTo(reopened.app, "agent.spawn")).toEqual([]);
});

it.each([[new Error("connection lost"), "unknown"], [new RpcError(-32603, "connection lost"), "unknown"], [new RpcError(-32003, "refused"), "failed"]] as const)("u2773b_rail_settlement_preserves_other_revisions: %s", async (failure, status) => {
  const mounted = await mountRail([workstream("w")]);
  let reject!: (error: Error) => void;

  mounted.app.handlers["agent.spawn"] = () => new Promise((_, fail) => { reject = fail; });
  open();
  fireEvent.input(field(), { target: { value: "older A" } });
  fireEvent.keyDown(field(), { key: "Enter" });
  fireEvent.input(field(), { target: { value: "newer B" } });
  reject(failure);
  await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>("Retained rail input").value).toBe("older A"));
  expect(field().value).toBe("newer B");
  await waitFor(() => expect(screen.getByLabelText("Retained rail input").parentElement?.dataset.state).toBe(status));
  cleanup();
  const reopened = await mountRail([workstream("w")]);
  open();
  expect(field().value).toBe("newer B");
  expect(screen.getByLabelText<HTMLTextAreaElement>("Retained rail input").value).toBe("older A");
  fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
  expect(field().value).toBe("newer B");
  expect(railCallsTo(reopened.app, "agent.spawn")).toEqual([]);
});

it("u2773a_rail_name_reopens_without_renaming", async () => {
  await mountRail([workstream("w")]);
  fireEvent.dblClick(screen.getByText("w"));
  fireEvent.input(screen.getByLabelText("Name"), { target: { value: "  e\u0301 😀  " } });
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
  cleanup();
  const mounted = await mountRail([workstream("w")]);
  fireEvent.dblClick(screen.getByText("w"));
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("  e\u0301 😀  ");
  expect(railCallsTo(mounted.app, "rail.rename")).toEqual([]);
});

it("u2773e_recovery_actions_keep_surface_draft", async () => {
  const mounted = await mountRail([workstream("w")]);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  open();
  fireEvent.input(field(), { target: { value: " exact unsaved 😀 " } });
  expect(screen.getByRole("alert").textContent).toContain("could not be retained");
  expect(field().value).toBe(" exact unsaved 😀 ");
  write.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Retry retention" }));
  expect(screen.queryByRole("alert")).toBeNull();
  cleanup();
  await mountRail([workstream("w")]);
  open();
  expect(field().value).toBe(" exact unsaved 😀 ");
  expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
});


it("u2773c_rail_external_change_keeps_original", async () => {
  const { app } = await mountRail([workstream("w")]);
  fireEvent.dblClick(screen.getByText("w"));
  fireEvent.input(screen.getByLabelText("Name"), { target: { value: "my name" } });
  app.emit({ name: "rail.changed", actor: { kind: "user", id: "you", parent: null } });
  app.handlers["rail.tree"] = () => [workstream("w", { name: "external" })];
  app.emit({ name: "rail.changed", actor: { kind: "user", id: "you", parent: null } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("original name changed"));
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("my name");
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
  expect(railCallsTo(app, "rail.rename")).toEqual([]);
});

it("u2773a_rail_clear_reopens_exact_reason", async () => {
  const node = workstream("w");
  const mounted = await mountRail([node]);
  const clearing = clearingOf(mounted.app, mounted.connected.events, node.id);
  clearing.open();
  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><ClearPrompt node={node} /></ConnectedProjectContext.Provider>);
  const reason = screen.getByRole<HTMLTextAreaElement>("textbox");
  fireEvent.input(reason, { target: { value: " exact\ne\u0301 😀 " } });
  fireEvent.keyDown(reason, { key: "Escape" });
  cleanup();
  const next = await mountRail([node]);
  clearingOf(next.app, next.connected.events, node.id).open();
  render(() => <ConnectedProjectContext.Provider value={next.connected}><ClearPrompt node={node} /></ConnectedProjectContext.Provider>);
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(" exact\ne\u0301 😀 ");
  expect(railCallsTo(next.app, "workstream.clear")).toEqual([]);
});

it("u2773b_rail_acknowledgement_consumes_only_submitted_work", async () => {
  const mounted = await mountRail([workstream("w")]);
  let finish!: (node: ReturnType<typeof agent>) => void;

  mounted.app.handlers["agent.spawn"] = () => new Promise((resolve) => { finish = resolve; });
  open();
  fireEvent.input(field(), { target: { value: "A" } });
  fireEvent.keyDown(field(), { key: "Enter" });
  fireEvent.input(field(), { target: { value: "B" } });
  finish(agent("new", "idle", "ready"));
  await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1));
  await Promise.resolve();
  expect(field().value).toBe("B");
  cleanup();
  await mountRail([workstream("w")]);
  open();
  expect(field().value).toBe("B");
  expect(screen.queryByLabelText("Retained rail input")).toBeNull();
});


it("u2773a_rail_restores_original_parent_after_selection_moves", async () => {
  const mounted = await mountRail([workstream("a"), workstream("b")]);
  mounted.app.handlers["agent.spawn"] = () => agent("new", "idle", "ready");
  mounted.rail.select("a");
  open();
  fireEvent.input(field(), { target: { value: "for A" } });
  fireEvent.keyDown(field(), { key: "Escape" });
  mounted.rail.select("b");
  open();
  fireEvent.keyDown(field(), { key: "Enter" });
  await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: "for A", parent: "a", model: null, effort: null }]));
});

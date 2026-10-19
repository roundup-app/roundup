import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";
import { clearingOf } from "./clear";
import { ClearPrompt } from "./ClearPrompt";
import { ConnectedProjectContext } from "../state/connectedProject";
import { render } from "@solidjs/testing-library";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const open = () => fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });

const field = () => screen.getByLabelText<HTMLTextAreaElement>("Task");

it("u2773b_rail_settlement_preserves_other_revisions_untyped_disconnect", async () => {
  const mounted = await mountRail([workstream("w")]);
  let reject!: (error: Error) => void;

  mounted.app.handlers["agent.spawn"] = () => new Promise((_, fail) => { reject = fail; });
  open();
  fireEvent.input(field(), { target: { value: "older A" } });
  fireEvent.keyDown(field(), { key: "Enter" });
  fireEvent.input(field(), { target: { value: "newer B" } });
  reject(new Error("connection lost"));
  await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>("Retained rail input").value).toBe("older A"));
  expect(field().value).toBe("newer B");
  await waitFor(() => expect(screen.getByLabelText("Retained rail input").parentElement?.dataset.state).toBe("unknown"));
  cleanup();
  const reopened = await mountRail([workstream("w")]);
  open();
  expect(field().value).toBe("newer B");
  expect(screen.getByLabelText<HTMLTextAreaElement>("Retained rail input").value).toBe("older A");
  fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
  expect(field().value).toBe("newer B");
  expect(railCallsTo(reopened.app, "agent.spawn")).toEqual([]);
});

it("u2773e_recovery_actions_keep_surface_draft", async () => {
  const mounted = await mountRail([workstream("w")]);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  open();
  fireEvent.input(field(), { target: { value: " exact unsaved 😀 " } });
  expect(screen.getByRole("alert").textContent).toMatch(/p:.*Task.*reload/);
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

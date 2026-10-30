import { copy as appCopy } from "../app/copy";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, workstream } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { mountRail, railCallsTo, rowOf, chooseAction, exitedTerminal } from "./railFixture";
import { openTabs, path } from "../header/stripFixture";
import { projectMenu, openProjectPage } from "../testing/menuProbe";
import { fakeEmulators } from "../terminal/paneHarness";
import { copy } from "./copy";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u4547d_restart_controls_share_the_focused_mode_action", async () => {
  const tree = [door("mode", "working", "", { opening_prompt: " exact\n ", yolo: true }), workstream("other")];
  const m = await mountRail(tree);
  m.app.handlers["workstream.restart"] = () => tree[0]!;
  m.rail.select("other");
  const row = rowOf("mode");
  fireEvent.click(within(row).getByRole("button", { name: copy.restart }));
  await waitFor(() => expect(railCallsTo(m.app, "workstream.restart")).toHaveLength(1));
  await m.rail.settled();
  fireEvent.click(within(row).getByRole("button", { name: copy.rowActions }));
  await m.app.pickMenu(copy.restart);
  row.focus();
  fireEvent.keyDown(row, { key: "r", code: "KeyR" });
  await waitFor(() => expect(railCallsTo(m.app, "workstream.restart")).toHaveLength(3));
  expect(railCallsTo(m.app, "workstream.restart")).toEqual(Array.from({ length: 3 }, () => ({ id: "mode", request: expect.any(String) })));
  expect(railCallsTo(m.app, "agent.resume")).toEqual([]);
  const other = rowOf("other");
  other.focus();
  fireEvent.keyDown(other, { key: "r", code: "KeyR" });
  expect(railCallsTo(m.app, "workstream.restart")).toHaveLength(3);
});

it("u4547d_pending_and_failed_restart_keep_one_operation", async () => {
  const tree = [workstream("mode", { opening_prompt: "prompt" })];
  const m = await mountRail(tree);
  let refuse!: (error: Error) => void;
  m.app.handlers["workstream.restart"] = () => new Promise((_, reject) => { refuse = reject; });
  const row = rowOf("mode");
  fireEvent.click(within(row).getByRole("button", { name: copy.restart }));
  row.focus();
  fireEvent.keyDown(row, { key: "r", code: "KeyR" });
  await chooseAction(m.app, "mode", copy.restart);
  expect(railCallsTo(m.app, "workstream.restart")).toHaveLength(1);
  refuse(new RpcError(-32003, "Door could not start. Restore Claude, then retry."));
  await screen.findByText("Door could not start. Restore Claude, then retry.");
  const original = railCallsTo(m.app, "workstream.restart")[0];
  m.app.handlers["workstream.restart"] = () => tree[0]!;
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await waitFor(() => expect(railCallsTo(m.app, "workstream.restart")).toEqual([original, original]));
  expect(m.rail.nodes[0]?.opening_prompt).toBe("prompt");
});

it("u4547d_only_explicit_restart_requests_a_fresh_session", async () => {
  const tree = [door("mode", "done", "", { opening_prompt: "saved", can_resume: true })];
  const m = await mountRail(tree, [exitedTerminal("mode", 0)]);
  m.app.handlers["agent.resume"] = () => tree[0]!;
  await chooseAction(m.app, "mode", copy.resume);
  expect(railCallsTo(m.app, "agent.resume")).toEqual([{ id: "mode" }]);
  m.rail.select("mode");
  await m.rail.refresh();
  await chooseAction(m.app, "mode", copy.openingPromptMenu);
  const field = await screen.findByRole("textbox", { name: copy.openingPrompt });
  field.focus();
  expect(fireEvent.keyDown(field, { key: "r", code: "KeyR" })).toBe(true);
  fireEvent.input(field, { target: { value: "edited" } });
  m.app.handlers["workstream.setOpeningPrompt"] = () => null;
  fireEvent.blur(field);
  await waitFor(() => expect(railCallsTo(m.app, "workstream.setOpeningPrompt")).toHaveLength(1));
  expect(railCallsTo(m.app, "workstream.restart")).toEqual([]);
  cleanup();
  const reopened = await mountRail([door("mode", "idle", "", { opening_prompt: "saved" })], [], undefined, undefined, { pane: fakeEmulators().factory });
  reopened.rail.select("mode");

  const terminal = await waitFor(() => {
    const screen = document.querySelector<HTMLElement>('[data-terminal="t-mode"]');
    expect(screen).not.toBeNull();

    return screen!;
  });

  terminal.focus();
  expect(fireEvent.keyDown(terminal, { key: "r", code: "KeyR" })).toBe(true);
  expect(railCallsTo(reopened.app, "workstream.restart")).toEqual([]);
});

it("u4547d_restart_controls_share_the_focused_mode_action_in_the_native_menu", async () => {
  const tree = [workstream("mode", { opening_prompt: "saved" })];
  const { app } = await openTabs({ p: tree });
  const daemon = app.of(path("p"));
  daemon.handlers["workstream.restart"] = () => tree[0]!;
  rowOf("mode").focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:R")).toMatchObject({ label: appCopy.restartModeInRail, enabled: true }));
  expect(projectMenu.items.find(item => item.id === "action:chord:R")?.shortcut).toBe("R");
  openProjectPage("action:chord:R", path("p"));
  await waitFor(() => expect(railCallsTo(daemon, "workstream.restart")).toHaveLength(1));
  expect(railCallsTo(daemon, "agent.resume")).toEqual([]);
  const field = screen.getByRole("textbox", { name: "Ask" });
  field.focus();
  await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:R")).toBe(false));
  expect(fireEvent.keyDown(field, { key: "r", code: "KeyR" })).toBe(true);
  expect(railCallsTo(daemon, "workstream.restart")).toHaveLength(1);
});

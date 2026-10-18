import type { WorktreeState } from "@contracts/agent/WorktreeState";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { ConnectedProjectContext } from "../state/connectedProject";
import { WorktreeControl } from "../changes/WorktreeControl";
import { mountRail, rowOf, glyphOf, settled } from "./railFixture";

const worktree = { path: "/p/a", branch: "topic", base: "base" };

afterEach(cleanup);

it("u2556c_chips_are_accessible_state", async () => {
  const { app, connected, setNow } = await mountRail([agent("a", "working", "busy", { worktree }), agent("plain", "idle", "ready")]);
  await waitFor(() => expect(connected.worktrees.read("a")?.failure).toBeNull());
  expect(document.querySelector(".worktree-chip")).toBeNull();
  app.handlers["agent.worktreeState"] = () => ({ ahead: 9, behind: 0, dirty: false, ci: { state: "failed", stale: false }, pr: { number: 2531, stale: true } });
  setNow(100_000_000_000_000);
  const chip = await screen.findByLabelText("9 ahead of Base");
  const ci = await screen.findByLabelText("CI failed");
  const pr = screen.getByLabelText("PR #2531, stale");

  for (const state of [ci, pr]) {
    expect(state.getAttribute("role")).toBe("img");
    expect(state.tabIndex).toBe(-1);
  }

  expect(ci.dataset.state).toBe("failed");
  expect(pr.dataset.state).toBe("pr");
  expect(pr.dataset.stale).toBe("true");
  expect(chip.dataset.state).toBe("ahead");
  expect(chip.getAttribute("role")).toBe("img");
  expect(chip.tabIndex).toBe(-1);
  fireEvent.click(chip);
  fireEvent.click(ci);
  fireEvent.click(pr);
  await settled();
  expect(rowOf("a").dataset.selected).toBe("true");
  expect(app.openedTargets).toEqual([]);
  expect(app.calls.some((call) => call.method === "terminal.spawn")).toBe(false);
  expect(rowOf("plain").querySelector("[data-state=ahead]")).toBeNull();
});

it("u2556c_updates_preserve_agent_interaction", async () => {
  const { app, connected, setNow } = await mountRail([agent("a", "working", "busy", { worktree }), agent("b", "idle", "ready")]);
  connected.rail.select("a");
  const glyph = glyphOf("a");
  const status = connected.rail.nodes[0]!.status;
  fireEvent.dblClick(screen.getByText("a"));
  const field = await screen.findByRole("textbox", { name: "Name" });
  field.focus();
  fireEvent.input(field, { target: { value: "my draft" } });
  await waitFor(() => expect(connected.worktrees.read("a")?.failure).toBeNull());
  let finish!: (state: WorktreeState) => void;

  app.handlers["agent.worktreeState"] = () => new Promise((resolve) => { finish = resolve; });
  setNow(100_000_000_000_000);
  fireEvent.input(field, { target: { value: "my draft" } });
  finish({ ahead: 4, behind: 0, dirty: false, ci: { state: "running", stale: false } });
  await screen.findByLabelText("4 ahead of Base");
  expect(screen.getByLabelText("CI running")).toBeTruthy();
  expect(document.activeElement).toBe(field);
  expect(field instanceof HTMLInputElement && field.value).toBe("my draft");
  expect(connected.rail.selected()).toBe("a");
  expect(glyph.isConnected).toBe(true);
  expect(connected.rail.nodes[0]!.status).toEqual(status);
  fireEvent.keyDown(field, { key: "Escape" });
  rowOf("a").focus();
  fireEvent.keyDown(rowOf("a"), { key: "ArrowDown" });
  await waitFor(() => expect(document.activeElement).toBe(rowOf("b")));
});

it("u2556d_both_views_share_facts_and_identity", async () => {
  const { app, connected, setNow } = await mountRail([agent("a", "working", "busy", { worktree })]);
  connected.rail.select("a");
  render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);
  let finish!: (value: WorktreeState) => void;
  await waitFor(() => expect(connected.worktrees.read("a")?.failure).toBeNull());
  app.handlers["agent.worktreeState"] = () => new Promise((resolve) => { finish = resolve; });
  app.handlers["agent.changedFiles"] = () => ({ files: [] });
  setNow(100_000_000_000_000);
  const count = app.calls.filter((call) => call.method === "agent.worktreeState").length;
  fireEvent.click(screen.getByRole("button", { name: "topic" }));
  expect(app.calls.filter((call) => call.method === "agent.worktreeState")).toHaveLength(count);
  finish({ ahead: 11, behind: 3, dirty: true, ci: { state: "running", stale: true }, pr: { number: 42, stale: false } });
  await screen.findByLabelText("11 ahead of Base");
  await screen.findByText("11 ahead, 3 behind, dirty");
  expect(screen.getByLabelText("CI running, stale").dataset.state).toBe("running");
  expect(screen.getByText("Running, stale")).toBeTruthy();
  expect(screen.getAllByText("#42")).toHaveLength(2);
  expect(app.calls.filter((call) => call.method === "agent.changedFiles")).toHaveLength(1);
});

it("u2556b_local_failure_is_reported_and_refresh_recovers", async () => {
  const { app, connected, setNow } = await mountRail([agent("a", "working", "busy", { worktree }), agent("b", "idle", "ready", { worktree: { ...worktree, path: "/p/b" } })]);
  await waitFor(() => expect(connected.worktrees.read("a")?.failure).toBeNull());

  let failed = true;

  app.handlers["agent.worktreeState"] = ({ id }) => {
    if (id === "a" && failed) throw new Error("worktree_missing: /p/a");

    return { ahead: 5, behind: 2, dirty: false };
  };

  app.handlers["agent.changedFiles"] = () => ({ files: [] });
  connected.rail.select("a");
  render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);
  setNow(100_000_000_000_000);
  fireEvent.click(screen.getByRole("button", { name: "topic" }));
  expect((await screen.findByRole("alert")).textContent).toContain("worktree_missing: /p/a");
  expect(rowOf("b").querySelector("[data-state=ahead]")?.getAttribute("aria-label")).toBe("5 ahead of Base");
  const unavailable = await screen.findByRole("img", { name: "Worktree state unavailable" });
  expect(unavailable.dataset.state).toBe("unavailable");
  failed = false;
  setNow(100_000_000_015_000);
  await screen.findByText("5 ahead, 2 behind");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("img", { name: "Worktree state unavailable" })).toBeNull();
});

it.each(["passed", "no-ci", "conflicts", "error", "unknown"] as const)("u2556c_ci_states_remain_distinct: %s", async (state) => {
  const { app, connected, setNow } = await mountRail([agent("a", "idle", "ready", { worktree })]);
  await waitFor(() => expect(connected.worktrees.read("a")?.failure).toBeNull());
  app.handlers["agent.worktreeState"] = () => ({ ahead: 0, behind: 0, dirty: false, ci: { state, stale: false } });
  setNow(100_000_000_000_000);
  await waitFor(() => expect(rowOf("a").querySelector(`[data-state="${state}"]`)).toBeTruthy());
  expect(rowOf("a").querySelector(`[data-state="${state}"]`)?.getAttribute("aria-label")).toBe(state === "no-ci" ? "No CI" : `CI ${state}`);
});

it("u2556b_unavailable_and_stale_are_explained", async () => {
  const { app, connected, setNow } = await mountRail([agent("a", "idle", "ready", { worktree })]);
  connected.rail.select("a");
  render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);
  app.handlers["agent.changedFiles"] = () => ({ files: [] });
  fireEvent.click(screen.getByRole("button", { name: "topic" }));
  await screen.findByText("CI unavailable");
  await screen.findByText("PR unavailable");
  app.handlers["agent.worktreeState"] = () => ({ ahead: 0, behind: 0, dirty: false, ci: { state: "passed", stale: true }, pr: { number: 18, stale: true } });
  setNow(100_000_000_000_000);
  await screen.findByText("Passed, stale");
  expect(screen.getByText("#18, stale")).toBeTruthy();
  expect(screen.getByRole("img", { name: "PR #18, stale" }).dataset.stale).toBe("true");
  expect(screen.getByLabelText("CI passed, stale").dataset.state).toBe("passed");
  expect(screen.getByLabelText("CI passed, stale").dataset.stale).toBe("true");
  expect(screen.queryByText("CI unavailable")).toBeNull();
});

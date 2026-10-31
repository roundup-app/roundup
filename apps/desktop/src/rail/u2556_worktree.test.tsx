import type { WorktreeState } from "@contracts/agent/WorktreeState";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { ConnectedProjectContext } from "../state/connectedProject";
import { WorktreeControl } from "../changes/WorktreeControl";
import { copy as changesCopy } from "../changes/copy";
import { mountRail, rowOf, rowGlyph as glyphOf, settled } from "./railFixture";

const worktree = { path: "/p/a", branch: "topic", base: "base" };

afterEach(cleanup);

it("u2556c_chips_are_accessible_state", async () => {
  const { app, connected, setNow } = await mountRail([agent("a", "working", "busy", { worktree }), agent("plain", "idle", "ready")]);
  await waitFor(() => expect(connected.worktrees.read("a")?.failure).toBeNull());
  expect(document.querySelector(".worktree-chip")).toBeNull();
  app.handlers["agent.worktreeState"] = () => ({ ahead: 9, behind: 0, dirty: false, ci: { state: "failed", stale: false }, pr: { number: 2531, stale: true } });
  setNow(100_000_000_000_000);
  const chip = await screen.findByLabelText("9 ahead");
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
  await screen.findByLabelText("4 ahead");
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
  app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", status: "modified", line: 1 }] });
  render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);
  let finish!: (value: WorktreeState) => void;
  await waitFor(() => expect(connected.worktrees.read("a")?.failure).toBeNull());
  app.handlers["agent.worktreeState"] = () => new Promise((resolve) => { finish = resolve; });
  setNow(100_000_000_000_000);
  const count = app.calls.filter((call) => call.method === "agent.worktreeState").length;
  fireEvent.click(await screen.findByRole("button", { name: /changed files?/ }));
  expect(app.calls.filter((call) => call.method === "agent.worktreeState")).toHaveLength(count);
  finish({ ahead: 11, behind: 3, dirty: true, ci: { state: "running", stale: true }, pr: { number: 42, stale: false } });
  await screen.findByLabelText("11 ahead");
  await screen.findByText(changesCopy.worktreeStateText(11, 3, true));
  expect(screen.getByLabelText("CI running, stale").dataset.state).toBe("running");



});

it("u2556b_local_failure_is_reported_and_refresh_recovers", async () => {
  const { app, connected, setNow } = await mountRail([agent("a", "working", "busy", { worktree }), agent("b", "idle", "ready", { worktree: { ...worktree, path: "/p/b" } })]);
  await waitFor(() => expect(connected.worktrees.read("a")?.failure).toBeNull());

  let failed = true;

  app.handlers["agent.worktreeState"] = ({ id }) => {
    if (id === "a" && failed) throw new Error("worktree_missing: /p/a");

    return { ahead: 5, behind: 2, dirty: false };
  };

  connected.rail.select("a");
  app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", status: "modified", line: 1 }] });
  render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);
  setNow(100_000_000_000_000);
  fireEvent.click(await screen.findByRole("button", { name: /changed files?/ }));

  expect(rowOf("b").querySelector("[data-state=ahead]")?.getAttribute("aria-label")).toBe("5 ahead");
  const unavailable = await screen.findByRole("img", { name: "Worktree state unavailable" });
  expect(unavailable.dataset.state).toBe("unavailable");
  failed = false;
  setNow(100_000_000_015_000);
  await screen.findByText(changesCopy.worktreeStateText(5, 2, false));
  expect(screen.queryByRole("alert")).toBeNull();

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
  app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "src/a.ts", status: "modified", line: 1 }] });
  render(() => <ConnectedProjectContext.Provider value={connected}><WorktreeControl /></ConnectedProjectContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: /changed files?/ }));
  await screen.findByText("CI unavailable");
  await screen.findByText("PR unavailable");
  await connected.worktrees.refresh("a");
  app.handlers["agent.worktreeState"] = () => ({ ahead: 0, behind: 0, dirty: false, ci: { state: "passed", stale: true }, pr: { number: 18, stale: true } });
  setNow(100_000_000_000_000);
  await screen.findByText("Passed, stale");

  expect(screen.getByRole("img", { name: "PR #18, stale" }).dataset.stale).toBe("true");
  expect(screen.getByLabelText("CI passed, stale").dataset.state).toBe("passed");
  expect(screen.getByLabelText("CI passed, stale").dataset.stale).toBe("true");

});

import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { waitFor } from "@solidjs/testing-library";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import { connectProject } from "./connectedProject";

const disposals: (() => void)[] = [];

afterEach(() => disposals.splice(0).forEach((dispose) => dispose()));

const worktree = { path: "/p/a", branch: "topic", base: "base" };

const facts = { ahead: 7, behind: 2, dirty: true };

it("u2556d_both_views_share_facts_and_identity", async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [agent("a", "working", "busy", { worktree })];
  let finish!: (state: WorktreeState) => void;
  app.handlers["agent.worktreeState"] = () => new Promise((resolve) => { finish = resolve; });
  const [now, tick] = createSignal(0);
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => false, now);
  createRoot((dispose) => { disposals.push(dispose); connected.worktrees.watch(() => true); });
  const first = connected.worktrees.refresh("a");
  const second = connected.worktrees.refresh("a");
  tick(4_000);
  expect(app.calls.filter((call) => call.method === "agent.worktreeState")).toHaveLength(1);
  finish(facts);
  await Promise.all([first, second]);
  await waitFor(() => expect(connected.worktrees.read("a")).toEqual({ failure: null, state: facts }));
  tick(4_999);
  expect(app.calls.filter((call) => call.method === "agent.worktreeState")).toHaveLength(1);
  tick(5_000);
  expect(app.calls.filter((call) => call.method === "agent.worktreeState")).toHaveLength(2);
});

it.each(["path", "branch", "base", "remove", "switch", "close", "exit"])("u2556b_late_results_do_not_cross_identity: %s", async (change) => {
  const app = createFakeApp();
  let tree = [agent("a", "working", "busy", { worktree })];
  app.handlers["rail.tree"] = () => tree;
  const replies: ((state: WorktreeState) => void)[] = [];
  app.handlers["agent.worktreeState"] = () => new Promise((resolve) => { replies.push(resolve); });
  const [visible, show] = createSignal(true);
  const [exit, end] = createSignal<{ code: number } | null>(null);
  const [now, tick] = createSignal(0);
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => false, now, exit);

  const stop = createRoot((dispose) => {
    connected.worktrees.watch(visible);

    return dispose;
  });

  disposals.push(stop);

  if (change === "close") stop();
  else if (change === "exit") end({ code: 1 });
  else if (change === "switch") show(false);
  else {
    tree = change === "remove" ? [] : [agent("a", "working", "busy", { worktree: { ...worktree, [change]: "replacement" } })];
    await connected.rail.refresh();
  }

  replies[0]!(facts);
  await Promise.resolve();
  await Promise.resolve();
  expect(connected.worktrees.read("a")).toBeUndefined();

  if (["close", "exit", "switch", "remove"].includes(change)) {
    tick(30_000);
    expect(replies).toHaveLength(1);
  } else {
    expect(replies).toHaveLength(2);
    replies[1]!({ ahead: 1, behind: 0, dirty: false });
    await waitFor(() => expect(connected.worktrees.read("a")).toEqual({ failure: null, state: { ahead: 1, behind: 0, dirty: false } }));
  }
});

it("u2556b_reopening_does_not_reuse_the_previous_owners_reply", async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [agent("a", "working", "busy", { worktree })];
  const replies: ((state: WorktreeState) => void)[] = [];
  app.handlers["agent.worktreeState"] = () => new Promise((resolve) => { replies.push(resolve); });
  const first = await connectProject(app, { path: "/p", name: "p" }, () => false, () => 0);

  const stop = createRoot((dispose) => {
    first.worktrees.watch(() => true);

    return dispose;
  });

  stop();
  const second = await connectProject(app, { path: "/p", name: "p" }, () => false, () => 0);
  createRoot((dispose) => { disposals.push(dispose); second.worktrees.watch(() => true); });
  replies[0]!(facts);
  await Promise.resolve();
  expect(second.worktrees.read("a")).toBeUndefined();
  replies[1]!({ ahead: 3, behind: 0, dirty: false });
  await waitFor(() => expect(second.worktrees.read("a")).toEqual({ failure: null, state: { ahead: 3, behind: 0, dirty: false } }));
});

it("u2556b_failure_is_contained_and_the_next_tick_recovers", async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [agent("a", "working", "busy", { worktree }), agent("b", "done", "finished", { worktree: { ...worktree, path: "/p/b" } }), agent("plain", "idle", "ready")];
  let failed = true;
  app.handlers["agent.worktreeState"] = ({ id }) => {
    if (id === "a" && failed) throw new Error("worktree_missing: /p/a");

    return facts;
  };

  const [now, tick] = createSignal(0);
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => false, now);
  createRoot((dispose) => { disposals.push(dispose); connected.worktrees.watch(() => true); });
  await waitFor(() => expect(connected.worktrees.read("a")).toEqual({ failure: "worktree_missing: /p/a" }));
  expect(connected.worktrees.read("b")).toEqual({ failure: null, state: facts });
  expect(app.calls.filter((call) => call.method === "agent.worktreeState").map((call) => call.params)).toEqual([{ id: "a" }, { id: "b" }]);
  failed = false;
  tick(15_000);
  await waitFor(() => expect(connected.worktrees.read("a")).toEqual({ failure: null, state: facts }));
});

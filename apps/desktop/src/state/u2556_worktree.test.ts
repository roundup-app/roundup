import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { waitFor } from "@solidjs/testing-library";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import { connectProject } from "./connectedProject";
import { createWorktreeState } from "./worktrees";

const disposals: (() => void)[] = [];

afterEach(() => disposals.splice(0).forEach((dispose) => dispose()));

const worktree = { path: "/p/a", branch: "topic", base: "base" };

const facts: WorktreeState = { ahead: 7, behind: 2, dirty: true, ci: { state: "failed", stale: true }, pr: { number: 42, stale: true } };

it("u2556d_both_views_share_facts_and_identity", async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [agent("a", "working", "busy", { worktree: { ...worktree } })];
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
  expect(await Promise.all([first, second])).toEqual([{ failure: null, state: facts }, { failure: null, state: facts }]);
  await waitFor(() => expect(connected.worktrees.read("a")).toEqual({ failure: null, state: facts }));
  tick(15_000);
  expect(app.calls.filter((call) => call.method === "agent.worktreeState")).toHaveLength(1);
  tick(30_000);
  expect(app.calls.filter((call) => call.method === "agent.worktreeState")).toHaveLength(2);
});

it.each(["path", "branch", "base", "remove", "switch", "close", "exit"].flatMap((change) =>
  ["initial", "refresh"].flatMap((request) => ["success", "failure"].map((outcome) => ({ change, request, outcome }))),
))("u2556b_late_results_do_not_cross_identity: $change / $request / $outcome", async ({ change, request, outcome }) => {
  const app = createFakeApp();
  let tree = [agent("a", "working", "busy", { worktree: { ...worktree } })];
  app.handlers["rail.tree"] = () => tree;
  const replies: { resolve: (state: WorktreeState) => void; reject: (error: Error) => void }[] = [];
  app.handlers["agent.worktreeState"] = () => new Promise((resolve, reject) => { replies.push({ resolve, reject }); });
  const [visible, show] = createSignal(true);
  const [exit, end] = createSignal<{ code: number } | null>(null);
  const [now, tick] = createSignal(0);
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => false, now, exit);
  // Exercise this state seam directly: connectProject separately owns a retry of rejected reads.
  const worktrees = createWorktreeState(app, connected.rail, now, exit);

  const stop = createRoot((dispose) => {
    worktrees.watch(visible);

    return dispose;
  });

  disposals.push(stop);

  if (request === "refresh") {
    replies[0]!.resolve(facts);
    await worktrees.refresh("a");
  }

  const first = worktrees.refresh("a");
  const second = worktrees.refresh("a");
  const count = request === "initial" ? 1 : 2;
  expect(app.calls.filter((call) => call.method === "agent.worktreeState").map((call) => call.params)).toEqual(Array.from({ length: count }, () => ({ id: "a" })));

  if (change === "close") stop();
  else if (change === "exit") end({ code: 1 });
  else if (change === "switch") show(false);
  else {
    tree = change === "remove" ? [] : [agent("a", "working", "busy", { worktree: { ...worktree, [change]: "replacement" } })];
    await connected.rail.refresh();
  }

  const pending = replies[count - 1]!;

  if (outcome === "success") pending.resolve(facts);
  else pending.reject(new Error("worktree_missing: /p/a"));

  const expected = outcome === "success" ? { failure: null, state: facts } : { failure: "worktree_missing: /p/a" };
  expect(await Promise.all([first, second])).toEqual([expected, expected]);
  expect(worktrees.read("a")).toBeUndefined();

  if (["close", "exit", "switch", "remove"].includes(change)) {
    tick(30_000);
    expect(replies).toHaveLength(count);
  } else {
    expect(replies).toHaveLength(count + 1);
    expect(app.calls.filter((call) => call.method === "agent.worktreeState").map((call) => call.params)).toEqual(Array.from({ length: count + 1 }, () => ({ id: "a" })));
    replies[count]!.resolve({ ahead: 1, behind: 0, dirty: false });
    await waitFor(() => expect(worktrees.read("a")).toEqual({ failure: null, state: { ahead: 1, behind: 0, dirty: false } }));
  }
});

it.each(["success", "failure"])("u2556b_reopening_does_not_reuse_the_previous_owners_reply: %s", async (outcome) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [agent("a", "working", "busy", { worktree: { ...worktree } })];
  const replies: { resolve: (state: WorktreeState) => void; reject: (error: Error) => void }[] = [];
  app.handlers["agent.worktreeState"] = () => new Promise((resolve, reject) => { replies.push({ resolve, reject }); });
  const connection = await connectProject(app, { path: "/p", name: "p" }, () => false, () => 0);
  const first = createWorktreeState(app, connection.rail, () => 0, () => null);

  const stop = createRoot((dispose) => {
    first.watch(() => true);

    return dispose;
  });

  const pending = first.refresh("a");
  stop();
  const replacement = await connectProject(app, { path: "/p", name: "p" }, () => false, () => 0);
  const second = createWorktreeState(app, replacement.rail, () => 0, () => null);
  createRoot((dispose) => { disposals.push(dispose); second.watch(() => true); });

  if (outcome === "success") replies[0]!.resolve(facts);
  else replies[0]!.reject(new Error("old connection read failed"));
  expect(await pending).toEqual(outcome === "success" ? { failure: null, state: facts } : { failure: "old connection read failed" });
  expect(app.calls.filter((call) => call.method === "agent.worktreeState").map((call) => call.params)).toEqual([{ id: "a" }, { id: "a" }]);
  expect(second.read("a")).toBeUndefined();
  replies[1]!.resolve({ ahead: 3, behind: 0, dirty: false });
  await waitFor(() => expect(second.read("a")).toEqual({ failure: null, state: { ahead: 3, behind: 0, dirty: false } }));
});

it("u2556b_failure_is_contained_and_the_next_tick_recovers", async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [agent("a", "working", "busy", { worktree: { ...worktree } }), agent("b", "done", "finished", { worktree: { ...worktree, path: "/p/b" } }), agent("plain", "idle", "ready")];
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
  expect(app.calls.filter((call) => call.method === "agent.worktreeState").map((call) => call.params)).toEqual([{ id: "a" }, { id: "b" }, { id: "a" }]);
  failed = false;
  tick(30_000);
  await waitFor(() => expect(connected.worktrees.read("a")).toEqual({ failure: null, state: facts }));
});

it("u2556b_opening_near_a_tick_does_not_add_a_poll", async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [agent("a", "working", "busy", { worktree: { ...worktree } })];
  app.handlers["agent.worktreeState"] = () => facts;
  const [now, tick] = createSignal(0);
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => false, now);
  createRoot((dispose) => { disposals.push(dispose); connected.worktrees.watch(() => true); });
  await waitFor(() => expect(connected.worktrees.read("a")?.failure).toBeNull());
  await connected.worktrees.refresh("a");
  tick(15_000);
  expect(app.calls.filter((call) => call.method === "agent.worktreeState")).toHaveLength(2);
  tick(30_000);
  expect(app.calls.filter((call) => call.method === "agent.worktreeState")).toHaveLength(3);
});

it.each(["unwatched", "plain", "missing", "hidden", "closed", "exited"])("s3806b_refresh_refuses_an_unavailable_entry: %s", async (cause) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [agent("a", "working", "busy", { worktree: { ...worktree } }), agent("plain", "idle", "ready")];
  app.handlers["agent.worktreeState"] = () => facts;
  const [visible, show] = createSignal(true);
  const [exit, end] = createSignal<{ code: number } | null>(null);
  const connected = await connectProject(app, { path: "/p", name: "p" }, () => false, () => 0, exit);

  const stop = createRoot((dispose) => {
    if (cause !== "unwatched") connected.worktrees.watch(visible);

    return dispose;
  });

  disposals.push(stop);

  if (cause === "hidden") show(false);
  else if (cause === "closed") stop();
  else if (cause === "exited") end({ code: 1 });
  const before = app.calls.length;
  const id = cause === "plain" || cause === "missing" ? cause : "a";
  expect(await connected.worktrees.refresh(id)).toEqual({ failure: expect.stringMatching(/\S/) });
  expect(app.calls).toHaveLength(before);
});

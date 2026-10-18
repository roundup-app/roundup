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

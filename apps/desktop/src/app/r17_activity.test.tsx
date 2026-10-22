import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, event, NOW } from "../testing/nodes";

const intervals = new Set<ReturnType<typeof setInterval>>();
const stopped: (Kind | null)[] = ["idle", "blocked", "needs-you", "error", "done", null];
const visibility = (value: "hidden" | "visible") => {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};
const settle = () => vi.advanceTimersByTimeAsync(0);
const mount = async (nodes: RailNode[] = [door("a", "working", "building", { worktree: { path: "/p/a", branch: "a", base: "main" } })]) => {
  const app = createFakeApp();
  app.opened.project = { path: "/p", name: "p" };
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["project.resources"] = () => ({ agents: [], total: { memory_bytes: 0, cpu_percent: 0, disk_bytes: null } });
  const clock = vi.fn(() => Date.now());
  const view = render(() => <App app={app} clock={clock} reducedMotion={() => true} />);
  await settle();
  expect(document.querySelector(".resource-strip")).not.toBeNull();
  return { app, clock, view };
};

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); visibility("visible");
  intervals.clear();
  const start = globalThis.setInterval;
  const stop = globalThis.clearInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation((...args) => {
    const id = start(...args);
    intervals.add(id);
    return id;
  });
  vi.spyOn(globalThis, "clearInterval").mockImplementation((id) => { intervals.delete(id); stop(id); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); visibility("visible"); });

it("r17_hidden_or_stopped_app_has_no_periodic_work", async () => {
  for (const kind of stopped) {
    const { app, clock, view } = await mount([agent("a", "idle", "stopped", { status: kind === null ? null : { kind, label: "stopped", since: NOW } })]);
    const reads = clock.mock.calls.length;
    app.calls.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clock).toHaveBeenCalledTimes(reads);
    expect(app.calls).toEqual([]);
    view.unmount();
  }
  visibility("hidden");
  const { app, clock } = await mount();
  const reads = clock.mock.calls.length;
  app.calls.length = 0;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(clock).toHaveBeenCalledTimes(reads);
  expect(app.calls).toEqual([]);
});

it("r19_hidden_or_stopped_app_has_zero_live_intervals", async () => {
  visibility("hidden");
  const { app, view } = await mount();
  expect(intervals.size).toBe(0);
  app.calls.length = 0;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(app.calls).toEqual([]);
  visibility("visible");
  await settle();
  expect(intervals.size).toBeGreaterThan(0);
  visibility("hidden");
  await settle();
  expect(intervals.size).toBe(0);
  view.unmount();
  visibility("visible");
  await mount([]);
  expect(intervals.size).toBe(0);
});

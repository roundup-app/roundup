import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { useDisplayNow } from "../state/clock";
import type { EmulatorFactory } from "../terminal/emulator";
import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { App } from "../App";
import type { FakeApp } from "../testing/fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { measurementFixture } from "../testing/measurementFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, event, NOW } from "../testing/nodes";

const intervals = new Set<Parameters<typeof clearInterval>[0]>();

const stopped: (Kind | null)[] = ["idle", "blocked", "needs-you", "error", "done", null];

const visibility = (value: "hidden" | "visible") => {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

let revision = 1;

const status = (app: FakeApp, id: string, kind: Kind) => app.emit(event({ name: "agent.status", data: { id, attempt: "1", status_revision: String(++revision), status: { kind, label: "stopped", since: Date.now() } } }));

const settle = () => vi.advanceTimersByTimeAsync(0);

const mount = async (nodes: RailNode[] = [door("a", "working", "building", { worktree: { path: "/p/a", branch: "a", base: "main" } })], setup?: (app: FakeApp) => void, createEmulator?: EmulatorFactory) => {
  // R17 observes absent display demand; the visible Board now subscribes even with idle Agents.
  localStorage.setItem("roundup:shelf:/p", JSON.stringify({ open: false }));
  const app = createFakeApp();
  app.opened.project = { path: "/p", name: "p" };
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["project.resources"] = () => ({ agents: [], total: { memory_bytes: 0, cpu_percent: 0, disk_bytes: null } });
  app.handlers["agent.changedFiles"] = () => ({ files: [] });
  app.handlers["project.measurementSummary"] = ({ home }) => {
    const sample = measurementFixture(home);

    return { ...sample, rows: [], contributors: 0, next_offset: null };
  };

  setup?.(app);
  const clock = vi.fn(() => Date.now());
  const view = render(() => <App app={app} clock={clock} reducedMotion={() => true} createEmulator={createEmulator ?? fakeEmulators().factory} />);
  await settle();
  expect(document.querySelector(".resource-strip")).not.toBeNull();
  const row = document.querySelector(`[role="treeitem"][data-id="${nodes[0]?.id}"]`);

  if (row) fireEvent.click(row);
  await settle();

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

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); visibility("visible"); });

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

  const empty = await mount([]);
  expect(intervals.size).toBe(0);
  empty.view.unmount();
  visibility("hidden");
  const { app, clock } = await mount();
  const reads = clock.mock.calls.length;
  app.calls.length = 0;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(clock).toHaveBeenCalledTimes(reads);
  expect(app.calls).toEqual([]);
});

it("r17_any_working_descendant_or_connected_project_keeps_the_clock_live", async () => {
  const { app, clock } = await mount([door("a", "done", "stopped"), agent("child", "idle", "stopped", { parent: "a" })], (app) => {
    localStorage.setItem("roundup:shelf:/other", JSON.stringify({ open: false }));
    app.add("/other");
    app.of("/p");
    app.of("/other").handlers["rail.tree"] = () => [agent("other", "idle", "stopped")];
  });

  expect(intervals.size).toBe(0);
  status(app, "child", "working");
  await settle();
  expect(intervals.size).toBe(1);
  let reads = clock.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(clock).toHaveBeenCalledTimes(reads + 1);
  status(app, "child", "done");
  expect(intervals.size).toBe(0);
  status(app.of("/other"), "other", "working");
  expect(intervals.size).toBe(1);
  app.exitDaemon({ code: 0 }, "/other");
  expect(intervals.size).toBe(0);
  reads = clock.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(clock).toHaveBeenCalledTimes(reads);
});

it("r17_resume_reads_current_time_without_catch_up", async () => {
  visibility("hidden");
  const { app, clock, view } = await mount();
  const reads = clock.mock.calls.length;
  await vi.advanceTimersByTimeAsync(3_600_000);
  visibility("visible");
  expect(clock).toHaveBeenCalledTimes(reads + 1);
  expect(clock.mock.results.at(-1)?.value).toBe(NOW + 3_600_000);
  visibility("visible");
  status(app, "a", "working");
  expect(intervals.size).toBe(2);
  expect(clock).toHaveBeenCalledTimes(reads + 1);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(clock).toHaveBeenCalledTimes(reads + 2);
  view.unmount();
  expect(intervals.size).toBe(0);
  visibility("hidden");
  visibility("visible");
  expect(clock).toHaveBeenCalledTimes(reads + 2);
});

it("r17_blur_is_not_hide", async () => {
  const { clock } = await mount();
  const reads = clock.mock.calls.length;
  window.dispatchEvent(new Event("blur"));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(clock).toHaveBeenCalledTimes(reads + 1);
  expect(intervals.size).toBe(2);
});

it("r17_events_and_explicit_refresh_work_while_suspended", async () => {
  const { app } = await mount([door("a", "idle", "stopped", { worktree: { path: "/p/a", branch: "branch-a", base: "main" } })]);
  const reads = () => app.calls.filter((call) => call.method === "agent.worktreeState").length;
  expect(reads()).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "branch-a" }));
  await settle();
  expect(reads()).toBe(2);
  const decision = { id: "question", agent: "a", tool: "permission", args: "{}", opened_at: NOW, answerable: true };
  app.emit(event({ name: "decision.opened", data: decision }));
  await settle();
  expect(document.querySelector(".decision-card")).not.toBeNull();
  status(app, "a", "blocked");
  expect(screen.getAllByRole("img", { name: "Blocked" }).length).toBeGreaterThan(0);
  expect(intervals.size).toBe(0);
  app.calls.length = 0;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(app.calls).toEqual([]);
});

it.each(["hidden", "stopped", "transition"] as const)("r19_hidden_or_stopped_app_has_zero_live_intervals: %s", async (initial) => {
  const assertSleeping = async (app: FakeApp) => {
    expect(intervals.size).toBe(0);
    app.calls.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.calls).toEqual([]);
  };

  visibility(initial === "hidden" ? "hidden" : "visible");
  let active = initial !== "stopped";

  const { app } = await mount([door("a", active ? "working" : "done", "building")], (app) => {
    app.handlers["project.measurementSummary"] = ({ home }) => {
      const sample = measurementFixture(home);

      return { ...sample, rows: [], contributors: 0, next_offset: null, time: { ...sample.time, active } };
    };
  });

  if (initial === "transition") {
    expect(intervals.size).toBeGreaterThan(0);
    visibility("hidden");
    await settle();
  }

  await assertSleeping(app);

  for (const name of ["Timeline", "Time"]) {
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".measurement-action button")].find((button) => button.textContent === name)!);
    await settle();
    await assertSleeping(app);

    if (initial !== "transition" || name !== "Time") {
      fireEvent.keyDown(document.querySelector(".timeline-view, .measurement-dashboard")!, { key: "Escape" });
      await settle();
    }
  }

  if (initial === "transition") {
    visibility("visible");
    await settle();
    expect(intervals.size).toBe(3);
    active = false;
    status(app, "a", "done");
    app.emit(event({ name: "project.measurementsChanged", data: { revision: "2" } }));
    await settle();
    await assertSleeping(app);
  }
});

it("u3308_idle_display_clock_demand_never_enables_periodic_rpcs", async () => {
  const [active, activate] = createSignal(false);
  const emulators = fakeEmulators();
  let board: (() => number) | undefined;

  const { app, clock, view } = await mount([
    door("a", "idle", "stopped", { worktree: { path: "/p/a", branch: "branch-a", base: "main" } }),
  ], (app) => {
    app.handlers["decision.list"] = () => [{ id: "question", agent: "a", tool: "permission", args: "{}", opened_at: NOW, answerable: true }];
  }, (id) => {
    board = useDisplayNow(active);

    return emulators.factory(id);
  });

  expect(board).toBeDefined();
  expect(app.calls.some((call) => call.method === "agent.worktreeState")).toBe(true);
  expect(document.querySelector(".decision-card")).not.toBeNull();
  activate(true);
  await settle();
  expect(board!()).toBe(NOW);
  expect(intervals.size).toBe(1);
  app.calls.length = 0;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(board!()).toBe(NOW + 60_000);
  expect(app.calls).toEqual([]);
  visibility("hidden");
  expect(intervals.size).toBe(0);
  const reads = clock.mock.calls.length;
  await vi.advanceTimersByTimeAsync(3_600_000);
  visibility("visible");
  await settle();
  expect(clock).toHaveBeenCalledTimes(reads + 1);
  expect(board!()).toBe(NOW + 3_660_000);
  expect(app.calls).toEqual([]);
  activate(false);
  expect(intervals.size).toBe(0);
  activate(true);
  expect(intervals.size).toBe(1);
  view.unmount();
  expect(intervals.size).toBe(0);
  const disposed = clock.mock.calls.length;
  visibility("hidden");
  visibility("visible");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(clock).toHaveBeenCalledTimes(disposed);
});

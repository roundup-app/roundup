import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, event } from "../testing/nodes";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { blocksOf } from "./model";
import { TimelineView } from "./TimelineView";
import { mountRailAndPane } from "../terminal/paneHarness";

const MIN = 60_000;

const NOW = Date.UTC(2026, 9, 22, 10, 30);

const at = (minute: number) => NOW - (30 - minute) * MIN;

const status = (id: string, attempt: string, kind: Kind, minute: number, revision = `${minute}`, ended = false) =>
  event({ name: "agent.status", data: { id, attempt, ended, status_revision: revision, status: { kind, label: kind, since: at(minute), finished: "0" } } });

const connect = async (tree: RailNode[], reduced: () => boolean) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => [];
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  const connected = await connectProject(app, { name: "p", path: "/p" }, reduced, () => NOW, () => null);

  return { app, connected };
};

const show = async (connected: Awaited<ReturnType<typeof connect>>["connected"], back: () => void = () => {}) => {
  const view = render(() => <ConnectedProjectContext.Provider value={connected}><TimelineView home="home" name="home" back={back} clock={() => Date.now()} /></ConnectedProjectContext.Provider>);

  await screen.findByRole("region", { name: "Timeline" });

  return view;
};

const mount = async (tree: RailNode[], options: { reduced?: boolean; back?: () => void } = {}) => {
  const [reduced, setReduced] = createSignal(options.reduced ?? false);
  const { app, connected } = await connect(tree, reduced);
  const view = await show(connected, options.back);

  return { app, connected, view, setReduced };
};

const lanes = () => within(screen.getByRole("list", { name: "Agents" })).getAllByRole("listitem").map((lane) => within(lane).getByRole("group").getAttribute("aria-label"));

const blocks = (lane: string) => within(screen.getByRole("group", { name: `${lane} over the last 30 minutes` })).queryAllByRole("img").filter((each) => each.classList.contains("timeline-block")).map((each) => [each.getAttribute("aria-label"), Number(each.dataset.start), Number(each.dataset.end)]);

beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: NOW }));

afterEach(() => { cleanup(); vi.useRealTimers(); });

const family = () => [
  door("home", "working", "go", { name: "Door", attempt: "1", status: { kind: "working", label: "go", since: at(0), finished: "0" } }),
  agent("a", "working", "go", { name: "Alpha", parent: "home", attempt: "1", status: { kind: "working", label: "go", since: at(5), finished: "0" } }),
  agent("b", "working", "go", { name: "Beta", parent: "a", attempt: "1", status: { kind: "working", label: "go", since: at(9), finished: "0" } }),
  door("other", "working", "go", { name: "Other door", attempt: "1", status: { kind: "working", label: "go", since: at(0), finished: "0" } }),
  agent("x", "working", "go", { name: "Stranger", parent: "other", attempt: "1", status: { kind: "working", label: "go", since: at(1), finished: "0" } }),
];

it("u3768a_lanes_cover_agents_of_the_workstream", async () => {
  const back = vi.fn();
  await mount(family(), { back });
  expect(lanes()).toEqual(["Door over the last 30 minutes", "Alpha over the last 30 minutes", "Beta over the last 30 minutes"]);
  fireEvent.keyDown(screen.getByRole("region", { name: "Timeline" }), { key: "Escape" });
  expect(back).toHaveBeenCalledOnce();
});

it("u3768b_blocks_follow_kind_changes_and_attempts", async () => {
  const { app } = await mount([door("home", "working", "go", { name: "Door", attempt: "2", status: { kind: "working", label: "go", since: at(20), finished: "0" } })]);
  app.emit(status("home", "1", "working", 0));
  app.emit(status("home", "1", "needs-you", 12));
  app.emit(status("home", "1", "working", 15));
  app.emit(status("home", "1", "done", 18));
  app.emit(status("home", "2", "working", 20));
  await waitFor(() => expect(blocks("Door")).toHaveLength(4));
  expect(blocks("Door")).toEqual([["Working", at(0), at(12)], ["Needs-you", at(12), at(15)], ["Working", at(15), at(18)], ["Working", at(20), NOW]]);
  expect(screen.queryAllByRole("img", { name: "Unknown" })).toHaveLength(0);
});

it("u3768b_a_log_shorter_than_the_window_leaves_an_unknown_span", async () => {
  await mount([door("home", "working", "go", { name: "Door", attempt: "1", status: { kind: "working", label: "go", since: at(10), finished: "0" } })]);
  expect(screen.getByRole("img", { name: "Unknown" })).toBeTruthy();
  expect(blocks("Door")).toEqual([["Working", at(10), NOW]]);
});

it("u3768b_a_view_opened_later_shows_the_history_before_it_opened", async () => {
  const [reduced] = createSignal(false);
  const { app, connected } = await connect([door("home", "working", "go", { name: "Door", attempt: "1", status: { kind: "working", label: "go", since: at(15), finished: "0" } }), agent("gone", "working", "go", { name: "Gone", parent: "home", attempt: "1", status: { kind: "working", label: "go", since: at(3), finished: "0" } })], reduced);
  app.emit(status("home", "1", "working", 0));
  app.emit(status("home", "1", "needs-you", 12));
  app.emit(status("home", "1", "working", 15));
  app.handlers["rail.tree"] = () => [door("home", "working", "go", { name: "Door", attempt: "1", status: { kind: "working", label: "go", since: at(15), finished: "0" } })];
  await connected.rail.refresh();
  await show(connected);
  expect(blocks("Door")).toEqual([["Working", at(0), at(12)], ["Needs-you", at(12), at(15)], ["Working", at(15), NOW]]);
  expect(lanes()).toEqual(["Door over the last 30 minutes", "Gone (removed) over the last 30 minutes"]);
  expect(screen.getByRole("img", { name: "Door started Gone" })).toBeTruthy();
});

it("u3768g_log_replays_saved_events_on_creation", async () => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => [door("home", "working", "go", { name: "Door", attempt: "1", status: { kind: "working", label: "go", since: at(15), finished: "0" } })];
  app.handlers["terminal.list"] = () => [];
  app.head = 3;
  const subscribe = app.subscribe;
  app.subscribe = async (listener, after) => {
    const head = await subscribe(listener, after);

    const saved: { kind: Kind; minute: number }[] = [{ kind: "working", minute: 0 }, { kind: "needs-you", minute: 12 }, { kind: "working", minute: 15 }];

    saved.forEach(({ kind, minute }, index) => app.emit({ ...status("home", "1", kind, minute), seq: index + 1 }));

    return head;
  };

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => NOW, () => null);
  const heard: string[] = [];
  connected.events.subscribe((each) => heard.push(each.name));

  await show(connected);
  expect(app.subscribed).toEqual([{ after: 0 }]);
  expect(blocks("Door")).toEqual([["Working", at(0), at(12)], ["Needs-you", at(12), at(15)], ["Working", at(15), NOW]]);
  expect(screen.queryAllByRole("img", { name: "Unknown" })).toHaveLength(0);
  // The replay reached no other listener; a repeat of a replayed Event adds no block, live or replayed again.
  expect(heard).toEqual([]);
  app.emit({ ...status("home", "1", "working", 15), seq: 3 });
  app.emit({ ...status("home", "1", "working", 15), seq: 4 });
  await vi.advanceTimersByTimeAsync(0);
  expect(blocks("Door")).toHaveLength(3);
  expect(heard).toEqual(["agent.status"]);
  app.emit(status("home", "1", "error", 20, "20", true));
  app.emit(status("home", "1", "error", 20));
  app.handlers["rail.tree"] = () => [door("home", "error", "failed", { name: "Door", attempt: "1", terminal_id: null, status: { kind: "error", label: "failed", since: at(15), finished: "0" } })];
  await connected.rail.refresh();
  expect(blocks("Door")).toEqual([["Working", at(0), at(12)], ["Needs-you", at(12), at(15)], ["Working", at(15), at(20)]]);
});

it("u3768c_lines_follow_subagent_parentage", async () => {
  await mount([...family(), agent("loose", "working", "x", { name: "Loose", parent: "home", attempt: "1" })]);
  expect(screen.getAllByRole("img").map((each) => each.getAttribute("aria-label")).filter((name) => / started /.test(name!))).toEqual(["Door started Alpha", "Alpha started Beta", "Door started Loose"]);
});

it("u3768c_a_removed_subagent_keeps_its_lane_and_line", async () => {
  const { app, connected } = await mount(family());
  app.handlers["rail.tree"] = () => family().filter((node) => node.id !== "b");
  await connected.rail.refresh();
  await screen.findByRole("group", { name: "Beta (removed) over the last 30 minutes" });
  expect(screen.getByRole("img", { name: "Alpha started Beta" })).toBeTruthy();
});

it("a3564a_a_waiting_block_selects_the_requesting_terminal", async () => {
  const tree = [door("home", "working", "go", { name: "Door", attempt: "1" }), agent("a", "needs-you", "asks", { name: "Alpha", parent: "home", attempt: "1", status: { kind: "needs-you", label: "asks", since: at(20), finished: "0" } })];
  const back = vi.fn();
  const { connected } = await mount(tree, { back });
  fireEvent.click(await screen.findByRole("button", { name: "Open Alpha" }));
  expect(connected.rail.selected()).toBe("a");
  expect(back).toHaveBeenCalledOnce();
});

it("u3768e_the_window_slides_only_while_an_agent_runs", async () => {
  const { app, view } = await mount([door("home", "working", "go", { name: "Door", attempt: "1", status: { kind: "working", label: "go", since: at(10), finished: "0" } })]);
  const region = screen.getByRole("region", { name: "Timeline" });
  const end = () => Number(region.dataset.windowEnd);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(end()).toBe(NOW + 3000);

  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  const kept = end();
  await vi.advanceTimersByTimeAsync(5000);
  expect(end()).toBe(kept);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(end()).toBe(NOW + 8000);
  expect(vi.getTimerCount()).toBe(1);

  app.emit(status("home", "1", "idle", 11));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  const idle = end();
  await vi.advanceTimersByTimeAsync(5000);
  expect(end()).toBe(idle);

  app.emit(status("home", "1", "working", 12));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  const before = app.calls.length;
  app.emit(status("home", "1", "idle", 13));
  expect(app.calls.length).toBe(before);
});

it("u3768f_only_the_slide_moves_and_reduced_motion_redraws", async () => {
  const { app, setReduced } = await mount([door("home", "working", "go", { name: "Door", attempt: "1", status: { kind: "working", label: "go", since: at(10), finished: "0" } })], { reduced: true });
  const region = screen.getByRole("region", { name: "Timeline" });
  const start = region.dataset.windowStart;
  await vi.advanceTimersByTimeAsync(2 * MIN);
  expect(region.dataset.windowStart).toBe(start);
  const open = () => Number(screen.getAllByRole("img", { name: "Working" })[0]!.dataset.end);
  expect(open() % MIN).toBe(0);
  expect(open()).toBeGreaterThan(NOW);
  app.emit(status("home", "1", "needs-you", 25));
  await vi.advanceTimersByTimeAsync(0);
  expect(region.dataset.windowStart).not.toBe(start);
  app.emit(status("home", "1", "working", 26));
  setReduced(false);
  await vi.advanceTimersByTimeAsync(0);
  const slid = region.dataset.windowEnd;
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(2000);
  expect(region.dataset.windowEnd).not.toBe(slid);
});

it("u3768a_the_pane_opens_the_timeline_and_escape_returns_focus", async () => {
  const { connected } = await mountRailAndPane(family());
  connected.rail.select("home");
  const open = await screen.findByRole("button", { name: "Timeline" });
  open.focus();
  fireEvent.click(open);
  const view = await screen.findByRole("region", { name: "Timeline" });
  fireEvent.click(within(view).getByRole("button", { name: "Close" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(open);
  fireEvent.click(open);
  fireEvent.keyDown(await screen.findByRole("region", { name: "Timeline" }), { key: "Escape" });
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(open);
  expect(connected.rail.selected()).toBe("home");
});


it.each([
  { kind: "done" as const, ended: true },
  { kind: "error" as const, ended: true },
  { kind: "idle" as const, ended: false },
])("u3768b_a_stopped_agent_has_no_span_after_its_stop_$kind", ({ kind, ended }) => {
  const samples = [{ at: at(0), attempt: "1", kind: "working" as const }, { at: at(10), attempt: "1", kind, ended }];

  for (const now of [at(20), at(30)]) {
    const result = blocksOf(samples, now);
    expect(result.every(block => block.end <= at(10))).toBe(true);
    expect(result.reduce((sum, block) => sum + block.end - block.start, 0)).toBe(10 * MIN);
  }

  const resumed = blocksOf([...samples, { at: at(25), attempt: "2", kind: "working" }], NOW);
  expect(resumed.map(block => [block.start, block.end])).toEqual([[at(0), at(10)], [at(25), NOW]]);
});

it("u3768a_exit_is_a_named_icon_button", async () => {
  const back = vi.fn();
  await mount(family(), { back });
  const exit = screen.getByRole("button", { name: "Close" });
  expect(screen.queryByText("Back")).toBeNull();
  expect(exit.textContent).toBe("");
  await vi.advanceTimersByTimeAsync(0);
  fireEvent.keyDown(document, { key: "Tab" });
  exit.focus();
  expect(await screen.findByRole("tooltip", { name: "Close" })).toBeTruthy();
  fireEvent.click(exit);
  expect(back).toHaveBeenCalledOnce();
});

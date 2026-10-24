import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { App } from "../App";
import { HOLD_MS } from "./dropTargets";
import type { FileDrop } from "./seam";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, info } from "../testing/nodes";
import { callsTo, fakeEmulators } from "../terminal/paneHarness";

const over = (x: number, y: number): FileDrop => ({ phase: "over", paths: [], x, y });

const drop = (x: number, y: number, ...paths: string[]): FileDrop => ({ phase: "drop", paths, x, y });

const LEAVE: FileDrop = { phase: "leave", paths: [], x: 0, y: 0 };

/** Rows are 30 high from y 40 in a Rail 200 wide; tabs 100 wide from x 0 in a strip 30 high; the centre is at x 300. */
const ROW_TOP = 40;

const tabX = (at: number) => at * 100 + 50;

const rowY = (id: string) => ROW_TOP + [...document.querySelectorAll(".rail-row")].findIndex((row) => row.getAttribute("data-id") === id) * 30 + 15;

const mount = async (trees: Record<string, RailNode[]>, terminals = [info("t-a1"), info("t-w1"), info("t-gone", { running: false, exit_code: 0 })]) => {
  window.localStorage.clear();
  URL.createObjectURL = () => "blob:fake";

  const app = createFakeApp();
  const { factory, made } = fakeEmulators();
  const names = Object.keys(trees);

  for (const name of names) {
    app.add(`/Users/me/${name}`);

    const daemon = app.of(`/Users/me/${name}`);

    daemon.handlers["rail.tree"] = () => trees[name] ?? [];

    daemon.handlers["terminal.list"] = () => terminals;
    daemon.handlers["terminal.write"] = () => null;
    daemon.handlers["terminal.resize"] = () => null;
    daemon.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  }

  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={factory} />);
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(names.length));
  await waitFor(() => expect(document.querySelectorAll(".rail-row").length).toBe((trees[names.at(-1)!] ?? []).length));

  const index = (element: Element, selector: string) => [...document.querySelectorAll(selector)].indexOf(element);

  // jsdom has no layout: each region gets the rectangle of the layout in the comment above, whenever it is asked.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const rects: [string, () => DOMRect][] = [
      [".rail", () => new DOMRect(0, ROW_TOP, 200, 760)],
      [".tablist", () => new DOMRect(0, 0, 400, 30)],
      [".rail-row", () => new DOMRect(0, ROW_TOP + index(this, ".rail-row") * 30, 200, 30)],
      [".project-tab", () => new DOMRect(index(this, ".project-tab") * 100, 0, 100, 30)],
      [".pane-body", () => new DOMRect(300, 100, 600, 500)],
    ];

    return rects.find(([selector]) => this.matches(selector))?.[1]() ?? new DOMRect(0, 0, 0, 0);
  });

  return { app, made };
};

const selected = () => document.querySelector(".rail-row[data-selected=true]")?.getAttribute("data-id");

const targets = () => [...document.querySelectorAll("[data-drop]")];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cleanup();
});

beforeEach(() => {
  // SAFETY: the Pane reads `undefined` as "no layout to ask", as jsdom has none.
  document.elementFromPoint = (() => undefined) as never;
});

const TREE = [agent("a1", "idle", "x"), door("w1", "idle", "idle"), agent("gone", "idle", "x", { terminal_id: "t-gone" })];

describe("u348 dragging files shows targets, a lingering drag opens one, a drop lands in it", () => {
  it("u348_over_shows_every_target_and_leave_clears_them", async () => {
    const { app } = await mount({ web: [agent("x1", "idle", "x")], api: TREE });

    fireEvent.click(document.querySelector('.rail-row[data-id="a1"]')!);
    await waitFor(() => expect(selected()).toBe("a1"));
    app.dropFiles(over(tabX(0), 15));
    expect(document.querySelectorAll(".rail-row[data-drop]")).toHaveLength(3);
    expect(document.querySelectorAll(".project-tab[data-drop]")).toHaveLength(2);
    expect(document.querySelectorAll(".pane-body[data-drop]")).toHaveLength(1);
    expect(document.querySelector(".project-tab[data-drop=hover]")).toBe(document.querySelectorAll(".project-tab")[0]);

    app.dropFiles(LEAVE);
    expect(targets()).toEqual([]);

    app.dropFiles(over(100, rowY("a1")));
    expect(document.querySelectorAll("[data-drop=hover]")).toHaveLength(1);
    app.dropFiles(over(-5, 10));
    expect(targets()).toEqual([]);
  });

  it("u348_holding_over_a_row_selects_it_after_600_ms", async () => {
    const { app } = await mount({ api: TREE });

    vi.useFakeTimers();
    app.dropFiles(over(100, rowY("w1")));
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(selected()).not.toBe("w1");

    vi.advanceTimersByTime(1);
    expect(selected()).toBe("w1");

    app.dropFiles(LEAVE);
    expect(selected()).toBe("w1");
  });

  it("u348_holding_over_a_tab_switches_to_it", async () => {
    const { app } = await mount({ web: [agent("x1", "idle", "x")], api: TREE });

    vi.useFakeTimers();
    app.dropFiles(over(tabX(0), 15));
    vi.advanceTimersByTime(HOLD_MS);

    expect(screen.getByRole("tab", { name: /^web/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("u348_moving_to_another_row_restarts_the_hold", async () => {
    const { app } = await mount({ api: TREE });

    vi.useFakeTimers();
    app.dropFiles(over(100, rowY("w1")));
    vi.advanceTimersByTime(400);
    app.dropFiles(over(100, rowY("gone")));
    vi.advanceTimersByTime(400);
    expect(selected()).not.toBe("w1");
    expect(selected()).not.toBe("gone");

    vi.advanceTimersByTime(200);
    expect(selected()).toBe("gone");
  });

  it("u348_leave_cancels_the_hold", async () => {
    const { app } = await mount({ api: TREE });

    vi.useFakeTimers();
    app.dropFiles(over(100, rowY("w1")));
    vi.advanceTimersByTime(300);
    app.dropFiles(LEAVE);
    vi.advanceTimersByTime(1000);

    expect(selected()).not.toBe("w1");
  });

  it("u348_a_drop_on_an_agent_row_pastes_into_its_pane", async () => {
    const { app, made } = await mount({ api: [agent("other", "idle", "x", { terminal_id: "t-other" }), ...TREE] }, [info("t-other"), info("t-a1"), info("t-gone", { running: false, exit_code: 0 })]);

    app.dropFiles(drop(100, rowY("a1"), "/p/a b.txt"));

    await waitFor(() => expect(selected()).toBe("a1"));
    await waitFor(() => expect(made.get("t-a1")!.pasted).toEqual(["'/p/a b.txt' "]));
    expect(callsTo(app.of("/Users/me/api"), "terminal.write")).toHaveLength(1);
    expect(targets()).toEqual([]);
  });

  it("u348_a_drop_on_an_exited_agent_pastes_nothing", async () => {
    const { app, made } = await mount({ api: TREE });

    app.dropFiles(drop(100, rowY("gone"), "/p/a.txt"));
    await new Promise((done) => setTimeout(done, 0));

    expect(selected()).toBe("gone");
    expect([...made.values()].flatMap((emulator) => emulator.pasted)).toEqual([]);
  });

  it("u348_a_drop_on_a_workstream_row_pastes_into_its_door", async () => {
    const { app, made } = await mount({ api: TREE });

    app.dropFiles(drop(100, rowY("w1"), "/p/Shot.PNG"));

    await waitFor(() => expect(selected()).toBe("w1"));
    await waitFor(() => expect(made.get("t-w1")!.pasted).toEqual(["'/p/Shot.PNG' "]));
  });

  it("u348_a_drop_elsewhere_does_nothing", async () => {
    const { app, made } = await mount({ api: TREE });

    app.dropFiles(over(250, 20));
    app.dropFiles(drop(250, 20, "/p/a.txt"));
    await new Promise((done) => setTimeout(done, 0));

    expect(targets()).toEqual([]);
    expect([...made.values()].flatMap((emulator) => emulator.pasted)).toEqual([]);
  });

  it("u348_a_drop_on_the_pane_pastes_once", async () => {
    const { app, made } = await mount({ api: [agent("a1", "idle", "x")] });

    fireEvent.click(document.querySelector(".rail-row")!);
    await waitFor(() => expect(selected()).toBe("a1"));
    app.dropFiles(drop(400, 300, "/p/a.txt"));

    await waitFor(() => expect(made.get("t-a1")!.pasted).toEqual(["'/p/a.txt' "]));
    expect(callsTo(app.of("/Users/me/api"), "terminal.write")).toHaveLength(1);
  });

  it("u348_a_drop_with_no_paths_shows_no_target_and_calls_nothing", async () => {
    const { app, made } = await mount({ api: TREE });

    app.dropFiles(drop(100, rowY("a1")));
    await new Promise((done) => setTimeout(done, 0));

    expect(targets()).toEqual([]);
    expect([...made.values()].flatMap((emulator) => emulator.pasted)).toEqual([]);
  });

  it("u348_targets_are_found_by_rectangle_on_the_densest_seed", async () => {
    const rows = Array.from({ length: 40 }, (_, at) => agent(`r${at}`, "idle", "x"));
    const trees = Object.fromEntries(Array.from({ length: 8 }, (_, at) => [`p${at}`, at === 7 ? rows : [agent(`q${at}`, "idle", "x")]]));
    const { app } = await mount(trees);

    vi.useFakeTimers();
    app.dropFiles(over(100, rowY("r20")));
    expect(document.querySelector("[data-drop=hover]")?.getAttribute("data-id")).toBe("r20");

    // The strip shows four tabs; the fifth is scrolled out of view and is no target.
    app.dropFiles(over(450, 15));
    expect(document.querySelector("[data-drop=hover]")).toBeNull();
  });
});

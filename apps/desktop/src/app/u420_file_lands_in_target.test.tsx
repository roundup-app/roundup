import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { App } from "../App";
import type { FileDrop } from "./seam";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, info } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";

const drop = (x: number, y: number, ...paths: string[]): FileDrop => ({ phase: "drop", paths, x, y });

const ROW_TOP = 40;

const tabX = (at: number) => at * 100 + 50;

const rowY = (id: string) => ROW_TOP + [...document.querySelectorAll(".rail-row")].findIndex((row) => row.getAttribute("data-id") === id) * 30 + 15;

const selected = () => document.querySelector(".rail-row[data-selected=true]")?.getAttribute("data-id");


const mount = async (trees: Record<string, RailNode[]>) => {
  window.localStorage.clear();
  URL.createObjectURL = () => "blob:fake";

  const app = createFakeApp();
  const { factory, made } = fakeEmulators();
  const names = Object.keys(trees);

  for (const name of names) {
    app.add(`/Users/me/${name}`);

    const daemon = app.of(`/Users/me/${name}`);

    daemon.handlers["rail.tree"] = () => trees[name] ?? [];
    daemon.handlers["terminal.list"] = () => [info("t-a1"), info("t-w1"), info("t-gone", { running: false, exit_code: 0 })];
    daemon.handlers["terminal.write"] = () => null;
    daemon.handlers["terminal.resize"] = () => null;
    daemon.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  }

  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={factory} />);
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(names.length));
  await waitFor(() => expect(document.querySelectorAll(".rail-row").length).toBe((trees[names.at(-1)!] ?? []).length));

  const index = (element: Element, selector: string) => [...document.querySelectorAll(selector)].indexOf(element);

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

const TREE = [agent("a1", "idle", "x"), door("w1", "idle", "idle"), agent("gone", "idle", "x", { terminal_id: "t-gone" })];

beforeEach(() => {
  // SAFETY: the Pane reads `undefined` as "no layout to ask", as jsdom has none.
  document.elementFromPoint = (() => undefined) as never;
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("u420 a file dropped on a target lands in that target", () => {
  it("u420_a_drop_on_a_project_tab_lands_in_its_selected_agent", async () => {
    const { app, made } = await mount({ web: TREE, api: [agent("z", "idle", "z")] });

    fireEvent.click(screen.getAllByRole("tab")[0]!);
    await waitFor(() => expect(document.querySelectorAll(".rail-row")).toHaveLength(3));
    fireEvent.click(document.querySelector('.rail-row[data-id="a1"]')!);
    await waitFor(() => expect(selected()).toBe("a1"));
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    await waitFor(() => expect(selected()).not.toBe("a1"));
    app.dropFiles(drop(tabX(0), 15, "/p/a b.txt"));

    await waitFor(() => expect(made.get("t-a1")!.pasted).toEqual(["'/p/a b.txt' "]));
  });

  it("u420_a_drop_on_a_project_tab_lands_in_its_selected_workstream", async () => {
    const { app, made } = await mount({ web: TREE, api: [agent("z", "idle", "z")] });

    fireEvent.click(screen.getAllByRole("tab")[0]!);
    await waitFor(() => expect(document.querySelectorAll(".rail-row")).toHaveLength(3));
    fireEvent.click(document.querySelector('.rail-row[data-id="w1"]')!);
    await waitFor(() => expect(selected()).toBe("w1"));
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    await waitFor(() => expect(selected()).not.toBe("w1"));
    app.dropFiles(drop(tabX(0), 15, "/p/notes.txt"));

    await waitFor(() => expect(made.get("t-w1")!.pasted).toEqual(["'/p/notes.txt' "]));
  });

  it("u420_a_drop_on_a_project_tab_with_no_selection_delivers_nothing", async () => {
    const { app, made } = await mount({ web: [agent("x1", "idle", "x")], api: TREE });

    app.dropFiles(drop(tabX(0), 15, "/p/a.png"));
    await new Promise((done) => setTimeout(done, 0));

    expect(screen.getByRole("tab", { name: /^web/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelectorAll("[data-drop]")).toHaveLength(0);
    expect(app.of("/Users/me/web").calls.filter((call) => call.method === "terminal.write")).toEqual([]);
    expect([...made.values()].flatMap((emulator) => emulator.pasted)).toEqual([]);
    expect(document.querySelector("[role=alert]")).toBeNull();
  });

  it("u420_a_non_image_dropped_on_a_workstream_pastes_into_its_door", async () => {
    const { app, made } = await mount({ api: TREE });

    app.dropFiles(drop(100, rowY("w1"), "/p/notes.txt"));
    await waitFor(() => expect(made.get("t-w1")!.pasted).toEqual(["'/p/notes.txt' "]));

    expect(document.querySelector("[role=alert]")).toBeNull();
  });

  it("u420_a_directory_dropped_on_a_workstream_pastes_into_its_door", async () => {
    const { app, made } = await mount({ api: TREE });

    app.dropFiles(drop(100, rowY("w1"), "/p/some dir/"));
    await waitFor(() => expect(made.get("t-w1")!.pasted).toEqual(["'/p/some dir/' "]));
  });
});

import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import railCss from "../rail/styles.css?inline";
import buttonCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import rowCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";
import shelfCss from "./styles.css?inline";

let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  sheet?.remove();
  cleanup();
  localStorage.clear();
});

const mountApp = async (seed: SeedName = "tree-40", reducedMotion = true) => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = [tokenCss, appCss, railCss, buttonCss, inkCss, rowCss, stripCss, shelfCss].join("\n");
  const controls = seedApp(seed, Date.now());

  render(() => <App app={controls.app} reducedMotion={() => reducedMotion} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  // Readiness must not compute styles across the full tree-40 App.
  await waitFor(() => screen.getByRole("tablist", { name: "Work items" }));

  return controls;
};

const shelf = () => document.querySelector<HTMLElement>(".shelf")!;

const tabs = () => within(screen.getByRole("tablist", { name: "Work items" })).getAllByRole("tab");

const tabNamed = (name: string) => tabs().find((tab) => tab.textContent!.startsWith(name))!;

const chord = (init: KeyboardEventInit = {}, target: Element | Document = document.body) =>
  leaderKey("KeyS", init, target);

const selectedTab = () => tabs().find((tab) => tab.getAttribute("aria-selected") === "true")!.textContent!.replace(/\d+$/, "");

describe("u373 the Shelf has two tabs", () => {
  it("u373_two_tabs_one_panel", async () => {
    await mountApp();

    expect(within(shelf()).getAllByRole("tabpanel")).toHaveLength(1);
    expect(selectedTab()).toBe("Todos");
  });

  it("u373_counts_follow_the_scope", async () => {
    await mountApp();
    const counts = () => ["Todos", "Pads"].map(name => tabNamed(name).querySelector(".shelf-count")?.textContent ?? "0");

    await waitFor(() => expect(counts()).toEqual(["7", "4"]));
    fireEvent.click(document.querySelector('.rail-row[data-id="payments"]')!);
    await waitFor(() => expect(counts()).toEqual(["0", "2"]));
    fireEvent.click(document.querySelector('.rail-row[data-id="tokens"]')!);
    await waitFor(() => expect(counts()).toEqual(["3", "0"]));
    fireEvent.click(document.querySelector('[data-todo-root]')!);
    await waitFor(() => expect(counts()).toEqual(["7", "4"]));
  });

  it("u373_a_zero_count_shows_nothing", async () => {
    await mountApp("empty-project");

    expect(tabs().map((tab) => tab.querySelector(".shelf-count"))).toEqual([null, null]);
  });

  it("u373_the_open_tab_survives_a_restart_per_project", async () => {
    const first = await mountApp();

    fireEvent.click(tabNamed("Pads"));
    expect(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith("roundup:shelf:"))!)!).tab).toBe("pads");

    cleanup();
    render(() => <App app={first.app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await screen.findAllByRole("treeitem");
    expect(selectedTab()).toBe("Pads");
  });

  it("u373_a_bad_stored_value_means_todos", async () => {
    localStorage.setItem("roundup:shelf:/Users/you/harness", JSON.stringify({ open: true, tab: 7 }));
    await mountApp();

    expect(selectedTab()).toBe("Todos");
  });

  it("u373_add_keeps_its_path", async () => {
    await mountApp();
    fireEvent.click(await within(shelf()).findByRole("button", { name: "add todo to Overview" }));
    expect(await screen.findByLabelText("New Todo title")).toBeTruthy();
    fireEvent.click(tabNamed("Pads"));
    fireEvent.click(await within(shelf()).findByRole("button", { name: "Add Pad" }));
    expect(await screen.findByLabelText("Pad name")).toBeTruthy();
  });
});

describe("u373 tab navigation", () => {
  it("u373_tab_navigation_stays_on_tabs", async () => {
    await mountApp();
    fireEvent.click(document.querySelector('[data-id="backend"]')!);

    for (const [key, name] of [["ArrowRight", "Pads"], ["ArrowLeft", "Todos"], ["End", "Pads"], ["Home", "Todos"]]) {
      tabNamed(selectedTab()).focus();
      fireEvent.keyDown(tabNamed(selectedTab()), { key });
      await waitFor(() => expect(document.activeElement).toBe(tabNamed(name!)));
    }
  });
});

describe("u369 and u371 the Shelf below the window bar", () => {
  it("u371_scroll_shadow_top_bottom_and_none", async () => {
    await mountApp();
    const wrap = document.querySelector<HTMLElement>(".shelf-scroll")!;
    const area = wrap.querySelector<HTMLElement>(".shelf-area")!;

    expect([wrap.dataset.clippedTop, wrap.dataset.clippedBottom]).toEqual(["false", "false"]);
    Object.defineProperty(area, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(area, "scrollHeight", { value: 300, configurable: true });
    area.scrollTop = 0;
    fireEvent.scroll(area);
    expect([wrap.dataset.clippedTop, wrap.dataset.clippedBottom]).toEqual(["false", "true"]);
    area.scrollTop = 80;
    fireEvent.scroll(area);
    expect([wrap.dataset.clippedTop, wrap.dataset.clippedBottom]).toEqual(["true", "true"]);
    area.scrollTop = 200;
    fireEvent.scroll(area);
    expect([wrap.dataset.clippedTop, wrap.dataset.clippedBottom]).toEqual(["true", "false"]);
  });


});

describe("u370 the Shelf closes and opens", () => {
  it("u373_tabs_remain_available_when_the_project_connection_fails", async () => {
    const controls = seedApp("tree-40", Date.now());

    controls.app.subscribe = async () => { throw new Error("Shelf connection refused"); };

    localStorage.setItem("roundup:shelf:/Users/you/harness", JSON.stringify({ open: false, tab: "todos" }));
    render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await screen.findByText("Shelf connection refused");

    fireEvent.click(tabNamed("Pads"));
    expect(shelf().hidden).toBe(false);
    expect(tabNamed("Pads").getAttribute("aria-expanded")).toBe("true");
    expect(tabs().every(tab => !tab.querySelector(".shelf-count"))).toBe(true);
    await waitFor(() => expect(within(shelf()).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabNamed("Pads").id));
  });

  it("u373_first_run_tabs_open_the_empty_shelf_without_counts", async () => {
    await mountApp("first-run");
    fireEvent.click(tabNamed("Todos"));
    expect(shelf().hidden).toBe(true);
    expect(tabs().map(tab => tab.querySelector(".shelf-count"))).toEqual([null, null]);
    fireEvent.click(tabNamed("Pads"));
    expect(shelf().hidden).toBe(false);
    expect(tabNamed("Pads").getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(within(shelf()).getByRole("tabpanel").id).toBe(tabNamed("Pads").getAttribute("aria-controls")));
  });

  it("u373_bar_tabs_toggle_with_a_drawer_open", async () => {
    await mountApp();

    const row = await waitFor(() => {
      const row = document.querySelector(".shelf .todo-row-button");

      expect(row).not.toBeNull();

      return row!;
    });

    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector('.drawer[data-open="true"]')).not.toBeNull());
    const drawer = document.querySelector('.drawer[data-open="true"]')!;

    fireEvent.click(tabNamed("Todos"));
    expect(shelf().hidden).toBe(true);
    expect(drawer.isConnected).toBe(true);
    fireEvent.click(tabNamed("Pads"));
    expect(shelf().hidden).toBe(false);
    expect(tabNamed("Pads").getAttribute("aria-expanded")).toBe("true");
    expect(drawer.isConnected).toBe(true);
  });

  it("u451_shelf_tabs_do_not_drag_or_zoom_the_window", async () => {
    const controls = await mountApp();

    for (const tab of tabs()) {
      for (const detail of [1, 2]) fireEvent.mouseDown(tab, { button: 0, detail });
      fireEvent.dblClick(tab);
    }

    expect(controls.app.windowOperations.filter(operation => operation.kind !== "title")).toEqual([]);
  });

  it("u373_the_open_tab_closes_it", async () => {
    await mountApp();
    chord();
    const row = document.querySelector<HTMLElement>(".rail-row")!;
    row.focus();
    fireEvent.click(tabNamed("Todos"));
    await waitFor(() => expect(document.activeElement).toBe(tabNamed("Todos")));

    fireEvent.click(tabNamed("Todos"));
    expect(shelf().hidden).toBe(true);
    expect(tabs().every(tab => tab.getAttribute("aria-expanded") === "false" && tab.getAttribute("aria-selected") === "false")).toBe(true);
    expect(document.activeElement).toBe(row);
  });

  it("u373_the_other_tab_switches", async () => {
    await mountApp();
    fireEvent.click(tabNamed("Pads"));
    expect(shelf().hidden).toBe(false);
    await waitFor(() => expect(shelf().querySelector('section[aria-label="Todos"]')).toBeNull());
    expect(tabNamed("Pads").getAttribute("aria-expanded")).toBe("true");
    expect(tabNamed("Todos").getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(within(shelf()).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabNamed("Pads").id));
  });

  it("u373_no_floating_toggle", async () => {
    await mountApp();

    for (const open of [true, false]) {
      expect(shelf().hidden).toBe(!open);
      expect(screen.queryByRole("button", { name: /^(Show|Hide) work items$/, hidden: true })).toBeNull();

      if (open) fireEvent.click(tabNamed("Todos"));
    }
  });

  it("u373_a_bar_tab_opens_the_shelf_on_it", async () => {
    await mountApp();
    chord();
    const pads = within(document.querySelector(".window-bar")!).getByRole("tab", { name: /^Pads/ });

    fireEvent.click(pads);
    expect(shelf().hidden).toBe(false);
    expect(pads.getAttribute("aria-selected")).toBe("true");
    expect(pads.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(within(shelf()).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(pads.id));
  });

  it("u370_leader_s_toggles_from_every_focus", async () => {
    await mountApp();
    const field = document.body.appendChild(document.createElement("input"));

    for (const from of [document.body, screen.getAllByRole("treeitem")[0]!, field]) {
      chord({}, from);
      expect(shelf().hidden).toBe(true);
      chord({}, from);
      expect(shelf().hidden).toBe(false);
    }

    field.remove();
  });

  it("u370_a_toggle_calls_no_unrelated_rpc", async () => {
    const controls = await mountApp();
    const before = controls.app.calls.length;

    chord();
    chord();
    expect(controls.app.calls.slice(before).filter((call) => call.method !== "terminal.resize")).toEqual([]);
  });

  it("u370_focus_returns_where_it_was", async () => {
    await mountApp();
    const row = document.querySelector<HTMLElement>(".rail-row")!;

    row.focus();
    chord();
    chord();
    await waitFor(() => expect(document.activeElement).toBe(tabNamed("Todos")));
    chord();
    expect(document.activeElement).toBe(row);
  });

  it("u370_esc_closes_only_from_inside", async () => {
    await mountApp();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(shelf().hidden).toBe(false);
    fireEvent.keyDown(tabNamed("Todos"), { key: "Escape" });
    expect(shelf().hidden).toBe(true);
  });

  it("u370_the_state_survives_a_restart_per_project", async () => {
    const first = await mountApp();

    chord();
    cleanup();
    render(() => <App app={first.app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await screen.findAllByRole("treeitem");
    expect(shelf().hidden).toBe(true);
    expect(shelf().getAttribute("data-animated")).toBe("false");
  });

});

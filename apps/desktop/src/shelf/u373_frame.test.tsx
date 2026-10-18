import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { event, terminal } from "../testing/nodes";
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

const observeShelf = (observe: () => void) => {
  // Force unrelated controls to compete with Shelf role queries, as the Rail does
  // on tree-40. Their style must not be observed to locate Shelf controls.
  const unrelated = document.body.appendChild(document.createElement("aside"));

  unrelated.innerHTML = '<button>Unrelated action</button>'.repeat(256);
  const original = window.getComputedStyle;
  let unrelatedReads = 0;

  const styles = vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    if (unrelated.contains(element)) unrelatedReads++;

    return original(element, pseudo);
  });

  try {
    observe();
    expect(unrelatedReads, "Shelf observation must not compute unrelated controls' styles").toBe(0);
  } finally {
    styles.mockRestore();
    unrelated.remove();
  }
};

describe("u373 the Shelf has two tabs", () => {
  it("u373_two_tabs_one_panel", async () => {
    await mountApp();

    expect(within(shelf()).getAllByRole("tabpanel")).toHaveLength(1);
    expect(selectedTab()).toBe("Todos");
  });

  it("u373_counts_follow_the_scope", async () => {
    await mountApp();

    await waitFor(() => expect(tabNamed("Todos").querySelector(".shelf-count")).not.toBeNull());
    const all = Number(tabNamed("Todos").querySelector(".shelf-count")!.textContent);

    await waitFor(() => expect(shelf().querySelectorAll("[data-todo]")).toHaveLength(all));
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
    fireEvent.click(await within(shelf()).findByRole("button", { name: "Add Todo" }));
    expect(await screen.findByLabelText("New Todo title")).toBeTruthy();
    fireEvent.click(tabNamed("Pads"));
    fireEvent.click(await within(shelf()).findByRole("button", { name: "Add Pad" }));
    expect(await screen.findByLabelText("Pad name")).toBeTruthy();
  });
});

describe("u470 the shared scope toggle", () => {
  const selectWorkstream = async () => {
    fireEvent.click(document.querySelector('[data-id="backend"]')!);

    return within(shelf()).findByRole("button", { name: "Show all Workstreams" });
  };

  it("u470_no_segmented_control_in_either_panel", async () => {
    await mountApp();
    await selectWorkstream();

    for (const name of ["Todos", "Pads"]) {
      if (selectedTab() !== name) fireEvent.click(tabNamed(name));
      expect(within(within(shelf()).getByRole("tabpanel")).queryByRole("group", { name: "Show Todos" })).toBeNull();
      expect(shelf().querySelector('input[type="radio"]')).toBeNull();
    }
  });

  it("u470_pressed_state_follows_the_press", async () => {
    await mountApp();
    const toggle = await selectWorkstream();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("u470_absent_without_a_workstream", async () => {
    const controls = await mountApp();
    const tree = await controls.app.rpc("rail.tree", null);

    controls.app.handlers["rail.tree"] = () => [...tree, terminal("scope-terminal")];
    controls.emit(event({ name: "rail.changed" }));
    await waitFor(() => expect(document.querySelector('[data-id="scope-terminal"]')).not.toBeNull());
    expect(within(shelf()).queryByRole("button", { name: "Show all Workstreams" })).toBeNull();

    for (const id of ["migrate", "scope-terminal"]) {
      await selectWorkstream();
      fireEvent.click(document.querySelector(`[data-id="${id}"]`)!);
      await waitFor(() => expect(within(shelf()).queryByRole("button", { name: /Show (all Workstreams|only this Workstream)/ })).toBeNull());
    }
  });

  it("u470_both_lists_and_counts_follow_one_scope", async () => {
    const controls = await mountApp();

    for (const home of ["backend", "auth", null]) {
      const made = await controls.app.rpc("todo.create", { title: "scope " + home, body: null, blockers: null });

      await controls.app.rpc("todo.move", { id: made.id, home });
      await controls.app.rpc("pad.create", { name: "scope-" + home, text: "" });
      await controls.app.rpc("pad.move", { name: "scope-" + home, home });
    }

    const toggle = await selectWorkstream();
    const counts = () => tabs().map(tab => Number(tab.querySelector(".shelf-count")?.textContent ?? 0));

    expect(counts()).toEqual([1, 1]);
    expect(shelf().querySelectorAll("[data-todo]")).toHaveLength(1);
    fireEvent.click(toggle);

    const wide = counts();

    expect(wide[0]).toBeGreaterThan(1);
    expect(wide[1]).toBeGreaterThan(1);
    expect(shelf().querySelectorAll("[data-todo]")).toHaveLength(wide[0]!);
    expect(shelf().textContent).toContain("scope null");
    expect(shelf().textContent).toContain("scope auth");
    fireEvent.click(tabNamed("Pads"));
    await waitFor(() => expect(shelf().querySelectorAll(".pad-name")).toHaveLength(wide[1]!));
    expect(screen.getByText("scope-null")).toBeTruthy();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(counts()).toEqual([1, 1]);
    expect(shelf().querySelectorAll(".pad-name")).toHaveLength(1);
  });

  it("u470_selection_resets_scope", async () => {
    await mountApp();
    fireEvent.click(await selectWorkstream());
    fireEvent.click(document.querySelector('[data-id="migrate"]')!);
    expect((await selectWorkstream()).getAttribute("aria-pressed")).toBe("false");
  });

  it("u470_hide_and_reopen_keep_scope", async () => {
    await mountApp();
    fireEvent.click(await selectWorkstream());

    observeShelf(() => {
      fireEvent.click(tabNamed("Todos"));
      expect(within(shelf()).queryByRole("button", { name: "Show only this Workstream" })).toBeNull();
      fireEvent.click(tabNamed("Todos"));
      expect(within(shelf()).getByRole("button", { name: "Show only this Workstream" }).getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("u470_scope_arrows_do_not_select_tabs", async () => {
    await mountApp();
    const toggle = await selectWorkstream();
    toggle.focus();

    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) fireEvent.keyDown(toggle, { key });
    expect(document.activeElement).toBe(toggle);
    expect(selectedTab()).toBe("Todos");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("u470_tab_navigation_stays_on_tabs", async () => {
    await mountApp();
    const toggle = await selectWorkstream();

    for (const [key, name] of [["ArrowRight", "Pads"], ["ArrowLeft", "Todos"], ["End", "Pads"], ["Home", "Todos"]]) {
      tabNamed(selectedTab()).focus();
      fireEvent.keyDown(tabNamed(selectedTab()), { key });
      await waitFor(() => expect(document.activeElement).toBe(tabNamed(name!)));
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
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

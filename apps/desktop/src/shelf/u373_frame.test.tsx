import { batch } from "solid-js";
import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Layout } from "../app/Layout";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";

afterEach(() => {
  if (live) return;
  batch(cleanup);
  localStorage.clear();
});

type Controls = Awaited<ReturnType<typeof mountApp>>;

// The tests of the "one mounted App" group only read and toggle state `reset` puts back, so they share one mount.
let live: Controls | undefined;

const shared = async () => {
  live ??= await mountApp();

  if (document.querySelector('.drawer[data-open="true"]')) fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.click(document.querySelector("[data-todo-root]")!);

  if (shelf().hidden) chord();

  if (selectedTab() !== "Todos") fireEvent.click(tabNamed("Todos"));
  await waitFor(() => expect(within(shelf()).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabNamed("Todos").id));

  return live;
};

const mountApp = async (seed: SeedName = "tree-40", reducedMotion = true) => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  const controls = seedApp(seed, Date.now());

  render(() => <App app={controls.app} reducedMotion={() => reducedMotion} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  await waitFor(() => expect(document.querySelector('[aria-label="Ask"]')).not.toBeNull());

  if (shelf().hidden) chord();
  await waitFor(() => expect(shelf().querySelector('[role="tablist"][aria-label="Bench"]')).not.toBeNull());

  return controls;
};

const shelf = () => document.querySelector<HTMLElement>(".shelf")!;

const tabs = () => within(screen.getByRole("tablist", { name: "Bench" })).getAllByRole("tab");

const tabNamed = (name: string) => tabs().find((tab) => tab.textContent!.startsWith(name))!;

const chord = (init: KeyboardEventInit = {}, target: Element | Document = document.body) =>
  leaderKey("KeyB", init, target);

const counts = () => ["todos", "pads"].map(tab => Number(shelf().querySelector(`#shelf-tab-${tab} .shelf-count`)?.textContent ?? 0));

const selectedTab = () => tabs().find((tab) => tab.getAttribute("aria-selected") === "true")!.textContent!.replace(/\d+$/, "");

describe("u373 and u370 on one mounted App", () => {
  afterAll(() => {
    batch(cleanup);
    localStorage.clear();
    live = undefined;
  });

  it.each([["payments", 0], ["tokens", 3], [null, 7]] as const)("u373_counts_follow_the_scope: %s", async (selected, todoCount) => {
    await shared();

    if (selected) fireEvent.click(document.querySelector(`.rail-row[data-id="${selected}"]`)!);
    await waitFor(() => expect(counts()).toEqual([todoCount, 4]));
  });

  it("u373_counts_follow_the_terminal_selected_in_the_switcher", async () => {
    const { app } = await shared();

    // The Switcher selects each Terminal's owner, including a Project-root Terminal.
    for (const [workstream, todoCount] of [["payments", 0], [null, 7]] as const) {
      const opened = await app.rpc("terminal.open", { workstream });

      leaderKey("KeyK");
      const field = await screen.findByRole("combobox");

      fireEvent.input(field, { target: { value: "zsh" } });

      const option = await waitFor(() => {
        const entry = document.querySelector(`[role="option"][data-value="terminal:${opened.terminal_id}"]`);

        expect(entry).not.toBeNull();

        return entry!;
      });

      fireEvent.click(option);
      await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
      await waitFor(() => expect(counts()).toEqual([todoCount, 4]));
    }
  });

  it("u373_folding_and_closing_keep_the_scope_counts", async () => {
    await shared();
    fireEvent.click(tabNamed("Pads"));
    await waitFor(() => expect(document.querySelector(".pads-tab [data-shelf-group]")).not.toBeNull());
    const group = document.querySelector<HTMLElement>('.pads-tab [data-shelf-group="payments"]')!;

    fireEvent.click(group.querySelector('[data-part="branch-control"]')!);
    await waitFor(() => expect(group.getAttribute("aria-expanded")).toBe("false"));
    await waitFor(() => expect(counts()).toEqual([7, 4]));
    fireEvent.click(tabNamed("Pads"));
    await waitFor(() => expect(shelf().hidden).toBe(true));
    // U2539b unmounts requested surfaces when closed; the chord reopens the retained Pads tab.
    chord();
    await waitFor(() => expect(shelf().hidden).toBe(false));
    await waitFor(() => expect(counts()).toEqual([7, 4]));
  }, 45_000);

  it("u373_tab_navigation_stays_on_tabs", async () => {
    await shared();
    fireEvent.click(document.querySelector('[data-id="backend"]')!);

    for (const [key, name] of [["ArrowRight", "Pads"], ["ArrowLeft", "Todos"], ["End", "Pads"], ["Home", "Todos"]]) {
      tabNamed(selectedTab()).focus();
      fireEvent.keyDown(tabNamed(selectedTab()), { key });
      await waitFor(() => expect(document.activeElement).toBe(tabNamed(name!)));
    }
  }, 45_000);

  it("u451_shelf_tabs_do_not_drag_or_zoom_the_window", async () => {
    const controls = await shared();

    for (const tab of tabs()) {
      for (const detail of [1, 2]) fireEvent.mouseDown(tab, { button: 0, detail });
      fireEvent.dblClick(tab);
    }

    expect(controls.app.windowOperations.filter(operation => operation.kind !== "title")).toEqual([]);
  });

  it("u373_the_other_tab_switches", async () => {
    await shared();
    expect(within(shelf()).getAllByRole("tabpanel")).toHaveLength(1);
    expect(document.getElementById("shelf-tab-todos")?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tabNamed("Pads"));
    expect(shelf().hidden).toBe(false);
    await waitFor(() => expect(shelf().querySelector('section[aria-label="Todos"]')).toBeNull());
    expect(document.getElementById("shelf-tab-pads")?.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("shelf-tab-todos")?.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(within(shelf()).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabNamed("Pads").id));
  });

  it("u370_leader_b_toggles_from_every_focus", async () => {
    const controls = await shared();
    const before = controls.app.calls.length;
    const field = document.body.appendChild(document.createElement("input"));

    for (const from of [document.body, screen.getAllByRole("treeitem")[0]!, field]) {
      chord({}, from);
      expect(shelf().hidden).toBe(true);
      chord({}, from);
      expect(shelf().hidden).toBe(false);
    }

    field.remove();
    expect(controls.app.calls.slice(before).filter((call) => !["terminal.resize", "pad.list"].includes(call.method))).toEqual([]);
  });

  it("u370_focus_returns_where_it_was", async () => {
    await shared();
    const row = document.querySelector<HTMLElement>(".rail-row")!;

    row.focus();
    chord();
    chord();
    await waitFor(() => expect(document.activeElement).toBe(tabNamed("Todos")));
    chord();
    expect(document.activeElement).toBe(row);
  });

  it("u370_esc_closes_only_from_inside", async () => {
    await shared();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(shelf().hidden).toBe(false);
    fireEvent.keyDown(tabNamed("Todos"), { key: "Escape" });
    expect(shelf().hidden).toBe(true);
  });
});

describe("u373 the Shelf has two tabs", () => {

  it("u373_a_zero_count_shows_nothing", async () => {
    await mountApp("empty-project");

    expect(tabs().map((tab) => tab.querySelector(".shelf-count"))).toEqual([null, null]);
  });

  it("u373_the_open_tab_survives_a_restart_per_project", async () => {
    const first = await mountApp();
    const chosen = tabNamed("Pads").id;

    fireEvent.click(tabNamed("Pads"));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith("roundup:shelf:"))!)!).tab).toBe("pads"));

    batch(cleanup);
    render(() => <App app={first.app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await screen.findAllByRole("treeitem");
    expect(within(screen.getByRole("tablist", { name: "Bench" })).getByRole("tab", { selected: true }).id).toBe(chosen);
  });

  it("u373_a_bad_stored_value_means_todos", async () => {
    localStorage.setItem("roundup:shelf:/Users/you/harness", JSON.stringify({ open: true, tab: 7 }));
    await mountApp();

    expect(document.getElementById("shelf-tab-todos")?.getAttribute("aria-selected")).toBe("true");
  });

  it("u373_add_keeps_its_path", async () => {
    // Add has no dependency on the forty owners used by the scope/count probes.
    await mountApp("empty-project");
    fireEvent.click(await within(shelf()).findByRole("button", { name: "Add Todo: Overview" }));
    const todoField = await screen.findByLabelText("New Todo title");
    await waitFor(() => expect(document.activeElement).toBe(todoField));
    fireEvent.click(tabNamed("Pads"));
    fireEvent.click(await within(shelf()).findByRole("button", { name: "Add Pad" }));
    const padField = await screen.findByLabelText("Pad name");
    await waitFor(() => expect(document.activeElement).toBe(padField));
  });
});

describe("u370 the Shelf closes and opens", () => {

  it("u370_the_state_survives_a_restart_per_project", async () => {
    const first = await mountApp();

    chord();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:shelf:/Users/you/harness") ?? "null")?.open).toBe(false));
    batch(cleanup);
    render(() => <App app={first.app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await screen.findAllByRole("treeitem");
    expect(shelf().hidden).toBe(true);
    expect(shelf().getAttribute("data-animated")).toBe("false");
  });

});

describe("u371 the Shelf selects its mode at the centre minimum", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([[387, "overlay"], [388, "reserved"], [389, "reserved"]] as const)("u371_minimum_pane_width_selects_the_mode_%i", (available, mode) => {
    // jsdom has no layout engine; supply the measured window and panel widths.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(480 + 560 + available);
    const style = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
      const computed = style(element);
      vi.spyOn(computed, "getPropertyValue").mockImplementation(name => ({ "--rail-width": "480px", "--shelf-span": "560px", "--centre-min-width": "388px" })[name] ?? "");

      return computed;
    });

    render(() => <Layout header={null} rail={null} centre={null} shelf={null} overlay={null} />);

    expect(document.querySelector(".window")?.getAttribute("data-shelf-mode")).toBe(mode);
  });
});

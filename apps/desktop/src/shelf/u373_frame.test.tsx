import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { event, terminal } from "../testing/nodes";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import tokenCss from "../tokens.css?inline";
import appCss from "../styles.css?inline";
import railCss from "../rail/styles.css?inline";
import buttonCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import rowCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";
import shelfCss from "./styles.css?inline";
import { CHORDS } from "../keys/chords";

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
  await waitFor(() => within(shelf()).getByRole("tablist", { name: "Shelf" }));

  return controls;
};

const shelf = () => document.querySelector<HTMLElement>(".shelf")!;

const tabs = () => within(screen.getByRole("tablist", { name: "Shelf" })).getAllByRole("tab");

const tabNamed = (name: string) => tabs().find((tab) => tab.textContent!.startsWith(name))!;

const chord = (init: KeyboardEventInit = {}, target: Element | Document = document.body) =>
  fireEvent.keyDown(target, { code: "Backslash", key: "\\", metaKey: true, ...init });

const selectedTab = () => tabs().find((tab) => tab.getAttribute("aria-selected") === "true")!.textContent!.replace(/\d+$/, "");

describe("u373 the Shelf has two tabs", () => {
  it("u373_two_tabs_one_panel", async () => {
    await mountApp();

    expect(tabs().map((tab) => tab.textContent!.replace(/\d+$/, ""))).toEqual(["Todos", "Pads"]);
    expect(within(shelf()).getAllByRole("tabpanel")).toHaveLength(1);
    expect(selectedTab()).toBe("Todos");
    expect(tabs().every((tab) => tab.getAttribute("data-button") === "quiet")).toBe(true);
  });

  it("u373_the_other_list_is_not_in_the_dom", async () => {
    await mountApp();

    expect(shelf().querySelector('section[aria-label="Pads"]')).toBeNull();
    expect(shelf().querySelector('section[aria-label="Todos"]')).not.toBeNull();
    fireEvent.click(tabNamed("Pads"));
    expect(shelf().querySelector('section[aria-label="Todos"]')).toBeNull();
    expect(shelf().querySelector('section[aria-label="Pads"]')).not.toBeNull();
  });

  it("u373_counts_follow_the_scope", async () => {
    await mountApp();

    await waitFor(() => expect(tabNamed("Todos").querySelector(".shelf-count")).not.toBeNull());
    const all = Number(tabNamed("Todos").querySelector(".shelf-count")!.textContent);

    fireEvent.click(tabNamed("Todos"));
    await waitFor(() => expect(shelf().querySelectorAll("[data-todo]")).toHaveLength(all));
  });

  it("u373_a_zero_count_shows_nothing", async () => {
    await mountApp("empty-project");

    expect(tabs().map((tab) => tab.querySelector(".shelf-count"))).toEqual([null, null]);
  });

  it("u373_arrow_keys_home_and_end", async () => {
    await mountApp();
    tabNamed("Todos").focus();
    fireEvent.keyDown(tabNamed("Todos"), { key: "ArrowRight" });
    await waitFor(() => expect(selectedTab()).toBe("Pads"));
    expect(document.activeElement).toBe(tabNamed("Pads"));
    fireEvent.keyDown(tabNamed("Pads"), { key: "ArrowRight" });
    await waitFor(() => expect(selectedTab()).toBe("Todos"));
    fireEvent.keyDown(tabNamed("Todos"), { key: "End" });
    await waitFor(() => expect(selectedTab()).toBe("Pads"));
    fireEvent.keyDown(tabNamed("Pads"), { key: "Home" });
    await waitFor(() => expect(selectedTab()).toBe("Todos"));
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1]);
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

  it("u470_one_icon_toggle_beside_hide_on_both_tabs", async () => {
    await mountApp();
    const toggle = await selectWorkstream();

    for (const name of ["Todos", "Pads"]) {
      fireEvent.click(tabNamed(name));
      expect(toggle.parentElement).toBe(screen.getByRole("tablist", { name: "Shelf" }).parentElement);
      expect(toggle.nextElementSibling).toBe(screen.getByRole("button", { name: "Hide Shelf" }));
      expect(toggle.getAttribute("data-button")).toBe("icon");
      expect(toggle.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
      expect(toggle.textContent).toBe("");
    }
  });

  it("u470_no_segmented_control_in_either_panel", async () => {
    await mountApp();
    await selectWorkstream();

    for (const name of ["Todos", "Pads"]) {
      fireEvent.click(tabNamed(name));
      expect(within(screen.getByRole("tabpanel")).queryByRole("group", { name: "Show Todos" })).toBeNull();
      expect(shelf().querySelector('input[type="radio"]')).toBeNull();
    }
  });

  it("u470_name_hover_text_and_pressed_state", async () => {
    await mountApp();
    const toggle = await selectWorkstream();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.title).toBe("Show all Workstreams");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Show only this Workstream");
    expect(toggle.title).toBe("Show only this Workstream");
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
      expect(within(shelf()).queryByRole("button", { name: /Show (all Workstreams|only this Workstream)/ })).toBeNull();
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
    expect(shelf().querySelectorAll(".pad-name")).toHaveLength(wide[1]!);
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
    fireEvent.click(screen.getByRole("button", { name: "Hide Shelf" }));
    expect(within(shelf()).queryByRole("button", { name: "Show only this Workstream" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show Shelf" }));
    expect(within(shelf()).getByRole("button", { name: "Show only this Workstream" }).getAttribute("aria-pressed")).toBe("true");
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
      fireEvent.keyDown(tabNamed(selectedTab()), { key });
      await waitFor(() => expect(document.activeElement).toBe(tabNamed(name!)));
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
    }
  });
});

describe("u369 and u371 the full-height Shelf", () => {
  it("u369_the_shelf_top_is_zero", async () => {
    await mountApp();
    const style = getComputedStyle(shelf());

    expect([style.position, style.top, style.bottom, style.right]).toEqual(["absolute", "0px", "0px", "0px"]);
    expect(shelf().parentElement!.classList.contains("window")).toBe(true);
  });

  it("u369_the_centre_floor_uses_the_shared_token", () => {
    expect(appCss).not.toContain("@media (max-width: 1101px)");
    expect(appCss).toMatch(/\.columns {[^}]*grid-template-columns: var\(--rail-width\) minmax\(var\(--centre-min-width\), 1fr\)/);
  });

  it("u371_the_shelf_paints_over_the_pane_below_the_drawer", async () => {
    await mountApp();

    expect(Number(getComputedStyle(shelf()).zIndex)).toBe(1);
    expect(Number(getComputedStyle(document.querySelector(".overlay")!).zIndex)).toBe(2);
  });

  it("u371_help_covers_the_shelf", async () => {
    await mountApp();
    const row = await waitFor(() => document.querySelector<HTMLElement>(".rail-row")!);

    row.dispatchEvent(new KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true, cancelable: true }));

    const help = document.querySelector(".help")!;

    expect(help).not.toBeNull();
    expect(document.querySelector(".overlay")!.contains(help)).toBe(true);
    expect(document.querySelector(".centre")!.contains(help)).toBe(false);
    expect(Number(getComputedStyle(document.querySelector(".overlay")!).zIndex)).toBeGreaterThan(Number(getComputedStyle(shelf()).zIndex));
  });

  it("u54_help_leaves_the_rail_uncovered", () => {
    expect(tokenCss).toMatch(/--rail-width: 288px/);
    expect(appCss).toMatch(/\.columns {[^}]*grid-template-columns: var\(--rail-width\)/);
    expect(appCss).toMatch(/\.help {[^}]*inset: calc\(var\(--header-height\) \+ var\(--space-4\)\) var\(--space-4\) var\(--space-4\) calc\(var\(--rail-width\) \+ var\(--space-4\)\)/);
  });

  it("u371_the_leading_edge_shadow_is_a_token", () => {
    expect(appCss).toMatch(/\.shelf::before {[^}]*box-shadow: var\(--shadow-shelf\)/);
    expect(tokenCss).toMatch(/--shadow-shelf: 0 0 24px rgba\(0, 0, 0, 0\.1\)/);
    expect(appCss).toMatch(/\.shelf::before {[^}]*opacity: 0/);
  });

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

  it("u371_d8_passes_with_the_new_shadows", () => {
    const shadows = [...(appCss + shelfCss).matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]!.trim());

    for (const value of shadows) expect(value).toMatch(/^(none|var\(--shadow-(drawer|shelf|scroll)\)|var\(--shadow-scroll[^)]*\))/);
  });

  it("u371_scroll_shadow_is_a_token", () => {
    expect(shelfCss).toMatch(/\.shelf-scroll::before,\s*\.shelf-scroll::after {[^}]*box-shadow: var\(--shadow-scroll\)/);
    expect(shelfCss).not.toMatch(/backdrop-filter/);
  });
});

describe("u370 the Shelf closes and opens", () => {
  it("u370_the_button_closes_and_opens", async () => {
    await mountApp();
    const hide = within(shelf()).getByRole("button", { name: "Hide Shelf" });

    expect(hide.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(hide);
    fireEvent.click(await within(document.querySelector("header")!).findByRole("button", { name: "Show Shelf" }));
    expect(shelf().hidden).toBe(false);
    expect(within(shelf()).getByRole("button", { name: "Hide Shelf" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("u370_the_chord_toggles_from_every_focus", async () => {
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

  it("u370_other_modifier_sets_do_nothing", async () => {
    await mountApp();

    for (const init of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: false }])
      expect(chord(init)).toBe(true);

    expect(shelf().hidden).toBe(false);
    
  });

  it("u370_a_held_chord_acts_once", async () => {
    await mountApp();
    chord();
    chord({ repeat: true });
    chord({ repeat: true });
    expect(shelf().hidden).toBe(true);
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
    const row = screen.getAllByRole("treeitem")[0]!;

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

  it("u370_help_lists_the_chord", () => {
    const keys = CHORDS.map((entry) => entry.keys);

    expect(keys.indexOf("⌘\\")).toBe(keys.indexOf("⇧⌘J") + 1);
    expect(CHORDS.find((entry) => entry.keys === "⌘\\")).toMatchObject({ what: "Show or hide the Shelf", presses: ["meta+Backslash"] });
  });
});

describe("u372 what the Shelf shows", () => {
  it("u372_no_horizontal_scroll_on_the_worst_case", async () => {
    await mountApp();
    expect(getComputedStyle(document.querySelector(".shelf-area")!).overflowX).toBe("clip");
  });
});

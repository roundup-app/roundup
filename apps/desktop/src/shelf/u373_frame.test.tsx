import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
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

  render(() => <App app={controls.app} reducedMotion={() => reducedMotion} clock={Date.now} />);
  await screen.findByRole("tablist", { name: "shelf" });

  return controls;
};

const shelf = () => document.querySelector<HTMLElement>(".shelf")!;

const tabs = () => within(screen.getByRole("tablist", { name: "shelf" })).getAllByRole("tab");

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

    expect(shelf().querySelector('section[aria-label="pads"]')).toBeNull();
    expect(shelf().querySelector('section[aria-label="todos"]')).not.toBeNull();
    fireEvent.click(tabNamed("Pads"));
    expect(shelf().querySelector('section[aria-label="todos"]')).toBeNull();
    expect(shelf().querySelector('section[aria-label="pads"]')).not.toBeNull();
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
    render(() => <App app={first.app} reducedMotion={() => true} clock={Date.now} />);
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
    fireEvent.click(await screen.findByRole("button", { name: "add todo" }));
    expect(await screen.findByLabelText("new todo title")).toBeTruthy();
    fireEvent.click(tabNamed("Pads"));
    fireEvent.click(await screen.findByRole("button", { name: "add pad" }));
    expect(await screen.findByLabelText("pad name")).toBeTruthy();
  });
});

describe("u368 the scope control", () => {
  it("u368_no_radio_input_in_the_shelf", async () => {
    await mountApp();
    expect(shelf().querySelector('input[type="radio"]')).toBeNull();
    fireEvent.click(tabNamed("Pads"));
    expect(shelf().querySelector('input[type="radio"]')).toBeNull();
  });

  const selectWorkstream = async () => {
    fireEvent.click(screen.getAllByRole("treeitem").find((row) => row.hasAttribute("aria-expanded"))!);

    return await screen.findByRole("group", { name: "show Todos" });
  };

  it("u368_two_quiet_buttons_one_pressed", async () => {
    await mountApp();

    const group = await selectWorkstream();
    const buttons = within(group).getAllByRole("button");

    expect(buttons.map((button) => [button.textContent, button.getAttribute("data-button")])).toEqual([["all", "quiet"], ["this one", "quiet"]]);
    expect(buttons.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  });

  it("u368_it_is_in_the_todos_panel_only", async () => {
    await mountApp();

    const group = await selectWorkstream();

    expect(screen.getByRole("tabpanel").contains(group)).toBe(true);
    fireEvent.click(tabNamed("Pads"));
    expect(screen.queryByRole("group", { name: "show Todos" })).toBeNull();
  });

  it("u368_arrow_and_space_press", async () => {
    await mountApp();

    const group = await selectWorkstream();
    const all = within(group).getAllByRole("button")[0]!;
    const thisOne = within(group).getAllByRole("button")[1]!;

    thisOne.focus();
    fireEvent.keyDown(thisOne, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(all);
    fireEvent.click(all);
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(thisOne.getAttribute("aria-pressed")).toBe("false");
  });

  it("u368_this_one_narrows_the_list_and_the_count", async () => {
    await mountApp();

    const group = await selectWorkstream();
    const all = within(group).getAllByRole("button")[0]!;
    const thisOne = within(group).getAllByRole("button")[1]!;

    fireEvent.click(all);
    const wide = shelf().querySelectorAll("[data-todo]").length;

    fireEvent.click(thisOne);
    expect(shelf().querySelectorAll("[data-todo]").length).toBeLessThanOrEqual(wide);
    expect(Number(tabNamed("Todos").querySelector(".shelf-count")?.textContent ?? 0)).toBe(shelf().querySelectorAll("[data-todo]").length);
  });

  it("u368_absent_without_a_workstream", async () => {
    await mountApp();
    expect(screen.queryByRole("group", { name: "show Todos" })).toBeNull();
  });

  it("u368_ui_font_and_hit_area", async () => {
    await mountApp();

    const group = await selectWorkstream();

    expect(getComputedStyle(group).fontFamily).toBe("var(--font-ui)");
    expect(getComputedStyle(within(group).getAllByRole("button")[0]!).minHeight).toBe("var(--space-5)");
  });
});

describe("u369 and u371 the Shelf floats over the window", () => {
  it("u369_the_shelf_top_is_zero", async () => {
    await mountApp();
    const style = getComputedStyle(shelf());

    expect([style.position, style.top, style.bottom, style.right]).toEqual(["absolute", "0px", "0px", "0px"]);
    expect(shelf().parentElement!.classList.contains("window")).toBe(true);
  });

  it("u369_the_rail_and_the_pane_do_not_move_at_700", () => {
    expect(appCss).not.toContain("@media (max-width: 1101px)");
    expect(appCss).toMatch(/\.columns {[^}]*grid-template-columns: var\(--rail-width\) minmax\(0, 1fr\)/);
  });

  it("u371_the_pane_box_is_the_same_open_and_closed", async () => {
    await mountApp();
    const columns = document.querySelector(".columns")!;
    const before = [columns.getAttribute("style"), columns.className, getComputedStyle(columns).gridTemplateColumns];

    chord();
    expect([columns.getAttribute("style"), columns.className, getComputedStyle(columns).gridTemplateColumns]).toEqual(before);
    expect(columns.contains(shelf())).toBe(false);
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
    const hide = within(shelf()).getByRole("button", { name: "hide Shelf" });

    expect(hide.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(hide);
    fireEvent.click(await screen.findByRole("button", { name: "show Shelf" }));
    expect(shelf().hidden).toBe(false);
    expect(screen.getByRole("button", { name: "hide Shelf" }).getAttribute("aria-expanded")).toBe("true");
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

  it("u370_a_toggle_calls_no_terminal_resize", async () => {
    const controls = await mountApp();
    const before = controls.app.calls.length;

    chord();
    chord();
    expect(controls.app.calls.slice(before).filter((call) => call.method === "terminal.resize" || call.method.startsWith("rail."))).toEqual([]);
  });

  it("u371_a_terminal_gets_no_resize", async () => {
    const controls = await mountApp();
    const before = controls.app.calls.length;

    chord();
    chord();
    expect(controls.app.calls.slice(before).map((call) => call.method)).toEqual([]);
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
    render(() => <App app={first.app} reducedMotion={() => true} clock={Date.now} />);
    await screen.findAllByRole("treeitem");
    expect(shelf().hidden).toBe(true);
    expect(shelf().getAttribute("data-animated")).toBe("false");
  });

  it("u370_help_lists_the_chord", () => {
    const keys = CHORDS.map((entry) => entry.keys);

    expect(keys.indexOf("⌘\\")).toBe(keys.indexOf("⇧⌘J") + 1);
    expect(CHORDS.find((entry) => entry.keys === "⌘\\")).toMatchObject({ what: "show or hide the Shelf", presses: ["meta+Backslash"] });
  });
});

describe("u372 what the Shelf shows", () => {
  it("u372_no_horizontal_scroll_on_the_worst_case", async () => {
    await mountApp();
    expect(getComputedStyle(document.querySelector(".shelf-area")!).overflowX).toBe("clip");
  });
});

import { showShelfTab } from "../testing/shelfTabs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { contrastRatio, resolveToken, tokensFrom } from "../testing/contrast";
import { driveStates, outlineRulesIn, styleIn, stylesIn } from "../testing/pointerStates";
import { seedApp } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import buttonsCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import padsCss from "../pads/styles.css?inline";
import railCss from "./styles.css?inline";
import terminalCss from "../terminal/styles.css?inline";
import rowButtonCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";
import { SpawnPromptField } from "./SpawnPromptField";
import "./styles.css";

const tokens = tokensFrom(tokenCss);

const resolved = (value: string) => value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => tokens.get(name) ?? name);

let undrive = () => {};

// main.tsx loads these two; the test mounts the App without it.
const shell = (() => {
  const sheet = document.createElement("style");
  sheet.textContent = `${tokenCss}\n${appCss}\n${buttonsCss}`;

  return sheet;
})();

afterEach(() => {
  undrive();
  undrive = () => {};

  shell.remove();
  cleanup();
});

const mount = async (seed: "tree-40" | "daemon-exits") => {
  document.head.prepend(shell);
  const controls = seedApp(seed, Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await found(() => document.querySelector("[role=treeitem]"));

  return controls;
};

// ItemDrawer publishes this control only after provenance.history and pad.read answer.
// A document-wide role query scans unrelated buttons while those reads are pending.
const exportButton = () => found(() => document.querySelector<HTMLButtonElement>('[aria-label="Drawer"] button[aria-label="Export .md"]'));

// A Workstream's treeitem wraps its row; the row (branch-control) is the target.
const CLICK_TARGET = "button, [role=treeitem]:not([data-part=branch]), [data-part=branch-control], .spawn-prompt-field";

const targetsIn = (root: ParentNode) => [...root.querySelectorAll(CLICK_TARGET)].filter((el) => !el.matches('[aria-disabled="true"]') && el.getAttribute("aria-disabled") !== "true");

const CASCADE_ATTRIBUTES = ["role", "type", "data-selected", "data-reorderable", "aria-disabled", "aria-expanded"];

const px = (value: string) => Number.parseFloat(resolved(value));

/** Waits for `look` to find an element; a role query would walk the whole accessibility tree, which costs far more than the clause under test. */
const found = <T extends Element>(look: () => T | null | undefined): Promise<T> =>
  waitFor(() => {
    const element = look();

    if (!element) throw new Error("not rendered yet");

    return element;
  });

/** The Rail, the Shelf, the header and the pane's pinned actions, then a Todo Drawer and a Pad Drawer open on top. */
const openEverything = async () => {
  await mount("tree-40");

  const todo = await found(() => [...document.querySelectorAll("button")].find((el) => /#5/.test(el.getAttribute("aria-label") ?? el.textContent ?? "")));
  fireEvent.click(todo);

  const drawer = await found(() => document.querySelector<HTMLElement>('[aria-label="Drawer"]'));

  const section = { rail: document.querySelector(".rail")!, shelf: document.querySelector(".shelf")!, header: document.querySelector(".header")!, drawer };

  undrive = driveStates();

  return section;
};

describe("u133 click targets", () => {
  it("u133_every_click_target_shows_hover_pressed_and_a_24px_hit_area", async () => {
    const regions = await openEverything();
    const all = Object.entries(regions).flatMap(([region, root]) => targetsIn(root).map((el) => ({ region, el })));

    expect(new Set(all.map((one) => one.region))).toEqual(new Set(["rail", "shelf", "header", "drawer"]));
    expect(all.length).toBeGreaterThan(20);

    // Targets that share a cascade key (region, tag, classes, role and state attributes) cascade alike, so one of each is measured.
    const cascadeKey = ({ region, el }: (typeof all)[number]) => [region, el.tagName, el.className, ...CASCADE_ATTRIBUTES.map((attribute) => `${attribute}=${el.getAttribute(attribute)}`)].join("|");
    const twins = new Map(all.map((one) => [cascadeKey(one), one.el]));
    const keys = [...twins.keys()];
    const measured = [...twins.values()];
    const [rests, hovers, presseds] = [stylesIn(measured, "rest"), stylesIn(measured, "hover"), stylesIn(measured, "pressed")];

    for (const one of all) {
      const { region, el } = one;
      const index = keys.indexOf(cascadeKey(one));
      const name = `${region} ${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)}`;
      const rest = rests[index]!;
      const hover = hovers[index]!;
      const pressed = presseds[index]!;
      const selected = el.getAttribute("data-selected") === "true";
      const paint = (style: CSSStyleDeclaration) => `${style.getPropertyValue("background-color")}|${style.getPropertyValue("background-image")}|${style.getPropertyValue("color")}`;

      // U155: a Todo row can be dragged, so its cursor is `grab`.
      const cursor = el.hasAttribute("data-reorderable") ? "grab" : "pointer";

      expect(hover.getPropertyValue("cursor"), name).toBe(cursor);
      expect(rest.getPropertyValue("cursor"), name).toBe(cursor);
      // The selected row's rest is already the wash a hover would draw.

      if (!selected) expect(paint(hover), `${name} hover`).not.toBe(paint(rest));
      expect(paint(pressed), `${name} pressed`).not.toBe(paint(hover));

      // U510: a ghost, icon or disclosure target answers hover and press with ink and paints no fill.
      if (/^(quiet|add|row-action|icon)$/.test(el.getAttribute("data-button") ?? "") && !el.matches('[role="tab"], .tab-name-button, .todo-project-root')) {
        expect(hover.getPropertyValue("background-color"), `${name} hover paints no fill`).toBe(rest.getPropertyValue("background-color"));
        expect(pressed.getPropertyValue("background-color"), `${name} press paints no fill`).toBe(rest.getPropertyValue("background-color"));
      }

      expect(pressed.getPropertyValue("transition-duration"), name).toBe("0s");
      expect(px(rest.getPropertyValue("min-height")), `${name} hit area`).toBeGreaterThanOrEqual(24);
    }
  });

  it("u133_the_prompt_field_hovers_presses_and_takes_the_same_ring", async () => {
    document.head.prepend(shell);
    render(() => <SpawnPromptField value="" onInput={() => {}} onSubmit={() => {}} onCancel={() => {}} ref={() => {}} />);
    undrive = driveStates();
    const field = screen.getByLabelText("Task");

    expect(styleIn(field, "hover").getPropertyValue("background-color")).not.toBe(styleIn(field, "rest").getPropertyValue("background-color"));
    expect(styleIn(field, "pressed").getPropertyValue("background-color")).not.toBe(styleIn(field, "hover").getPropertyValue("background-color"));
    expect(outlineRulesIn(field, "focus")).toEqual(["[data-state-focus]", ".spawn-prompt-field[data-state-focus]"]);
  });

  it("u133_the_shared_ring_only_moves_for_tick_boxes_and_full_width_rail_rows", async () => {
    const sheets = { "styles.css": appCss, "ink/styles.css": inkCss, "pads/styles.css": padsCss, "rail/styles.css": railCss, "terminal/styles.css": terminalCss, "todos/rowButton.styles.css": rowButtonCss, "header/strip.styles.css": stripCss, "tokens.css": tokenCss };
    const withOutline = Object.entries(sheets).flatMap(([file, css]) => [...css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*(?<![\w-])outline(?:-[a-z]+)?\s*:[^{}]*)\}/g)].map((rule) => ({ file, selector: rule[1]!.trim(), body: rule[2]! })));
    const ring = withOutline.filter((rule) => /outline-color\s*:/.test(rule.body) && !/outline-width\s*:\s*0\s*;?\s*$/.test(rule.body.trim()));

    expect(ring).toHaveLength(1);
    expect(ring[0]!.file).toBe("styles.css");
    expect(ring[0]!.selector).toBe(":focus-visible");
    expect(ring[0]!.body).toMatch(/outline-width:\s*2px;\s*outline-style:\s*solid;\s*outline-color:\s*var\(--accent\)/);
    // U361 moves the same accent ring from the hit area to its visible Glyph.
    // It inherits the shared ring while its hit area has zero outline width.
    const relocated = withOutline.filter((rule) => rule !== ring[0]);

    expect(relocated.map(({ file, selector }) => ({ file, selector }))).toEqual([
      { file: "rail/styles.css", selector: ".spawn-prompt-field:focus-visible" },
      { file: "rail/styles.css", selector: ".rail-tree .app-tree .rail-row:focus-visible" },
      { file: "todos/rowButton.styles.css", selector: ".todo-tick:focus-visible" },
      { file: "todos/rowButton.styles.css", selector: ".todo-tick:focus-visible::before" },
    ]);
    expect(relocated[0]!.body.trim()).toBe("outline-width: 0;");
    expect(relocated[1]!.body.trim()).toBe("outline-offset: calc(-1 * var(--space-1));");
    expect(relocated[2]!.body.trim()).toBe("outline-width: 0;");
    expect(relocated[3]!.body).toMatch(/outline:\s*inherit;\s*outline-width:\s*2px;\s*outline-offset:\s*2px;/);
  });

  it("u133_the_ring_is_3_to_1_against_the_ground_and_the_sunken_surface", () => {
    for (const ground of ["ground", "sunken"]) expect(contrastRatio(resolveToken("var(--accent)", tokens), resolveToken(`var(--${ground})`, tokens))).toBeGreaterThanOrEqual(3);
  });

  it("u133_a_row_the_prompt_the_drawer_buttons_and_a_todo_field_show_the_same_ring", async () => {
    const regions = await openEverything();
    const row = regions.rail.querySelector(".rail-row")!;
    const close = within(regions.drawer).getByRole("button", { name: "Close" });
    const fields = [document.body.appendChild(document.createElement("input")), document.body.appendChild(document.createElement("textarea"))];

    for (const el of [row, close, ...fields]) {
      expect(outlineRulesIn(el, "focus"), el.tagName).toEqual(el === row ? ["[data-state-focus]", '.app-tree [data-part="branch-control"][data-state-focus],\n.app-tree [data-part="item"][data-state-focus]', ".rail-tree .app-tree .rail-row[data-state-focus]"] : ["[data-state-focus]"]);
      expect(styleIn(el, "focus").getPropertyValue("outline-width")).toBe("2px");
      expect(styleIn(el, "focus").getPropertyValue("outline-offset")).toBe(el === row ? "calc(-1 * var(--space-1))" : "1px");
    }
  });

  it("u133_stop_close_promote_collapse_and_export_md_are_buttons_with_a_24px_hit_area", async () => {
    await mount("tree-40");
    showShelfTab("Pads");
    fireEvent.click(await found(() => document.querySelector<HTMLElement>(".shelf .pad-name")));
    const exportMd = await exportButton();
    const drawer = await found(() => document.querySelector<HTMLElement>('[aria-label="Drawer"]'));
    undrive = driveStates();
    const named = [...document.querySelectorAll(".rail button"), ...drawer.querySelectorAll("button")];
    const labels = named.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim());

    expect(labels).toEqual(expect.arrayContaining(["Close", "Collapse", "Export .md"]));
    expect(exportMd.tagName).toBe("BUTTON");
    expect(within(drawer).getByRole("button", { name: "Export .md" })).toBe(exportMd);

    for (const el of named) expect(px(getComputedStyle(el).minHeight), `${el.getAttribute("aria-label") ?? el.textContent}`).toBeGreaterThanOrEqual(24);
  });

  it("u133_export_wait_does_not_scan_button_styles_before_the_pad_read_publishes", async () => {
    const controls = await mount("tree-40");
    const read = controls.app.handlers["pad.read"]!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });

    controls.app.handlers["pad.read"] = async (params) => {
      started();
      await held;

      return read(params);
    };

    showShelfTab("Pads");
    fireEvent.click(await found(() => document.querySelector<HTMLElement>(".shelf .pad-name")));
    await reading;
    expect(document.querySelector('[aria-label="Export .md"]')).toBeNull();

    // Force the query to start before ItemDrawer's read publishes its buttons.
    // Accessible-name queries compute styles across the whole App on every poll.
    const styles = vi.spyOn(window, "getComputedStyle");
    const exported = exportButton();

    try {
      expect(styles).not.toHaveBeenCalled();
    } finally {
      styles.mockRestore();
      release();
      await exported;
    }

    expect((await exported).tagName).toBe("BUTTON");
  });

  it("u133_a_disabled_button_has_grey_text_cursor_default_and_aria_disabled", async () => {
    const controls = await mount("daemon-exits");
    controls.app.exitDaemon({ code: 1 });
    await waitFor(() => expect(document.querySelectorAll('button[aria-disabled="true"]').length).toBeGreaterThan(0));
    undrive = driveStates();
    const disabled = [...document.querySelectorAll('button[aria-disabled="true"]')];

    expect(disabled.length).toBeGreaterThan(0);

    for (const el of disabled) {
      expect(el.hasAttribute("disabled"), el.textContent ?? "").toBe(false);
      expect(styleIn(el, "rest").getPropertyValue("color")).toBe("var(--disabled)");
      expect(styleIn(el, "rest").getPropertyValue("cursor")).toBe("default");
      expect(styleIn(el, "hover").getPropertyValue("color")).toBe("var(--disabled)");
      expect(styleIn(el, "hover").getPropertyValue("cursor")).toBe("default");
    }
  });

  it("u133_a_rail_menu_button_reads_its_font_size_from_a_type_step", async () => {
    await mount("tree-40");
    fireEvent.contextMenu(document.querySelector(".rail-row")!);
    const buttons = within(await screen.findByRole("menu")).getAllByRole("menuitem");

    expect(buttons.length).toBeGreaterThan(0);

    for (const button of buttons) expect(["13px", "var(--text-body)", "var(--text-title)", "inherit"], button.textContent!).toContain(getComputedStyle(button).fontSize);
  });
});

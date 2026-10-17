import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { resolveToken, tokensFrom } from "../testing/contrast";
import { runChecks } from "../testing/checks";
import { agent } from "../testing/nodes";
import { seedApp } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import { mountRail } from "./railFixture";

const tokens = tokensFrom(tokenCss);

const KINDS = ["error", "needs-you", "working", "blocked", "idle", "done"] as const;

// docs/design-system.md, "Colour".
const TABLE = { error: ["cross", "red"], "needs-you": ["disc", "amber"], working: ["quarter", "accent"], blocked: ["dashed", "grey"], idle: ["ring", "grey"], done: ["check", "grey"] } as const;

const INK = new Set(["error", "needs-you"]);

const shell = document.createElement("style");

shell.textContent = `${tokenCss}\n${appCss}`;

afterEach(() => {
  shell.remove();
  cleanup();
});

const mountSeed = async (seed: "agents-10" | "tree-40") => {
  document.head.prepend(shell);
  const controls = seedApp(seed, Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");
};

const colourOf = (el: Element) => resolveToken(getComputedStyle(el).color, tokens);

const hueOf = (hex: string): number => {
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  const [r, g, b] = [channel(1), channel(3), channel(5)];
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  const lightness = (max + min) / 2;

  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
};

const glyphsOf = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.glyph[role="img"]')];

/** The Kind a Glyph draws, from its drawing and tone, so a decorative one (a row that names its Kind in text) counts too. */
const kindDrawn = (glyph: Element) => KINDS.find((kind) => glyph.getAttribute("data-drawing") === TABLE[kind][0] && glyph.getAttribute("data-tone") === TABLE[kind][1]) ?? null;

const drawnIn = (row: ParentNode) => [...row.querySelectorAll(".glyph")].flatMap((glyph) => kindDrawn(glyph) ?? []);

describe("u132 colour and Kind", () => {
  it("u132_each_glyph_is_the_one_the_design_system_assigns_its_kind_in_its_tone", async () => {
    await mountSeed("agents-10");
    // Ten Agents; the oldest `done` one folds into the `✓ <n> done` line (U8).
    expect(screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id")).length).toBeGreaterThanOrEqual(9);
    fireEvent.click(screen.getByRole("treeitem", { name: /done/ }));
    expect(new Set(glyphsOf(document.body).map((glyph) => glyph.getAttribute("aria-label")?.toLowerCase()))).toEqual(new Set(KINDS));

    for (const glyph of glyphsOf(document.body)) {
      // SAFETY: the `new Set(...)` assertion above has shown every label is one of KINDS.
      const [icon, tone] = TABLE[glyph.getAttribute("aria-label")?.toLowerCase() as (typeof KINDS)[number]];

      expect(glyph.getAttribute("data-drawing"), glyph.getAttribute("aria-label")!).toBe(icon);
      expect(colourOf(glyph), glyph.getAttribute("aria-label")!).toBe(resolveToken(`var(--${tone})`, tokens));
    }
  });

  it("u404_ink_rows_are_bold_in_their_tone_and_every_other_name_is_regular", async () => {
    await mountSeed("agents-10");

    const weight = (el: Element) => Number(getComputedStyle(el).fontWeight === "bold" ? 700 : getComputedStyle(el).fontWeight);

    for (const row of screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id"))) {
      const kind = row.querySelector('.glyph[role="img"]')!.getAttribute("aria-label")!.toLowerCase();
      const heaviest = Math.max(...[row, ...row.querySelectorAll("*")].map(weight));

      expect(weight(row.querySelector(".name")!), kind).toBe(INK.has(kind) ? 700 : 400);
      expect(heaviest >= 700, kind).toBe(INK.has(kind));
    }
  });

  it("u132_every_saturated_colour_is_red_amber_or_accent", async () => {
    await mountSeed("agents-10");
    const allowed = ["red", "amber", "accent"].map((name) => resolveToken(`var(--${name})`, tokens).toLowerCase());
    const drawn = [...document.body.querySelectorAll("*")].flatMap((el) => ["color", "background-color", "border-top-color", "border-left-color", "outline-color"].map((property) => resolveToken(getComputedStyle(el).getPropertyValue(property), tokens).toLowerCase()));
    const saturated = drawn.filter((colour) => /^#[0-9a-f]{6}$/.test(colour) && hueOf(colour) > 0.15);

    expect(saturated.length).toBeGreaterThan(0);
    expect(saturated.filter((colour) => !allowed.includes(colour))).toEqual([]);
    expect(runChecks().D3.status).toBe("pass");
  });

  it("u132_a_rail_with_no_error_and_no_needs_you_draws_no_red_and_no_amber", async () => {
    document.head.prepend(shell);
    await mountRail([agent("a", "working", "w"), agent("b", "blocked", "w"), agent("c", "idle", "w"), agent("d", "done", "w")]);
    const [red, amber] = ["red", "amber"].map((name) => resolveToken(`var(--${name})`, tokens));
    const drawn = [...document.body.querySelectorAll("*")].flatMap((el) => ["color", "background-color", "border-top-color", "outline-color"].map((property) => resolveToken(getComputedStyle(el).getPropertyValue(property), tokens)));

    expect(glyphsOf(document.body)).toHaveLength(4);
    expect(drawn).not.toContain(red);
    expect(drawn).not.toContain(amber);
    expect(document.querySelectorAll(".ink")).toHaveLength(0);
    expect(runChecks().D3.status).toBe("pass");
  });

  it("u132_rows_keep_their_kind_with_u361_tick_boxes_on_todos", async () => {
    await mountSeed("tree-40");
    const known = new Set<string | null>(KINDS);
    await screen.findAllByRole("button", { name: /#5/ });
    const shelfRows = [...document.querySelectorAll(".todo-row-button")];
    const shelfRowBoxes = shelfRows.map((button) => button.closest(".shelf-row")!);

    expect(shelfRows.length).toBeGreaterThan(0);

    // A Workstream has no Kind, so its row draws a chevron and no Kind Glyph.
    for (const row of screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id")).filter((item) => !item.hasAttribute("aria-expanded")))
      expect(drawnIn(row), row.outerHTML.slice(0, 300)).toHaveLength(1);

    // U361 replaces the idle/done Todo Glyph with a native tick box,
    // retaining the blocked Glyph and the done fold's summary Glyph.
    for (const row of shelfRowBoxes) {
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const blocked = row.querySelector('.todo-row-button')?.getAttribute("aria-label")?.startsWith("blocked ");

      expect(drawnIn(row), row.outerHTML.slice(0, 300)).toHaveLength(box ? blocked ? 1 : 0 : 1);

      if (box) expect(box.checked).toBe(box.disabled);
    }

    fireEvent.click(shelfRows[0]!);
    const drawer = await screen.findByRole("complementary", { name: "Drawer" });

    // U461 uses the shared tick box in the Todo header; dependencies retain their Glyphs.
    await waitFor(() => expect(drawer.querySelector(".todo-tick")).not.toBeNull());
    expect(glyphsOf(drawer).every((glyph) => known.has(glyph.getAttribute("aria-label")?.toLowerCase() ?? null))).toBe(true);
  }, 20_000);
});

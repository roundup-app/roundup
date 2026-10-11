import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { contrastRatio } from "../testing/contrast";
import { driveStates, outlineRulesIn, styleIn } from "../testing/pointerStates";
import appCss from "../styles.css?inline";
import buttonsCss from "../buttons.css?inline";
import tokenCss from "../tokens.css?inline";

const KINDS = ["primary", "quiet", "add", "row-action", "icon"] as const;

/** The Token values of one colour scheme, read from `tokens.css`: the `:root` block, then the dark column over it. */
const tokensOf = (dark: boolean) => {
  const blocks = [...tokenCss.matchAll(/:root\s*\{([^}]*)\}/g)].map((block) => block[1]!);
  const used = dark ? [blocks[0]!, blocks[1]!] : [blocks[0]!];
  const tokens = new Map<string, string>();

  for (const block of used) for (const declaration of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens.set(declaration[1]!, declaration[2]!.trim());

  return tokens;
};

const px = (value: string) => Number.parseFloat(value.replace(/var\(--space-5\)/, "24px"));

let undrive = () => {};

let sheet: HTMLStyleElement | null = null;

afterEach(() => {
  undrive();

  undrive = () => {};

  sheet?.remove();
  cleanup();
});

const fixture = () => {
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = `${tokenCss}\n${appCss}\n${buttonsCss}`;
  render(() => (
    <div>
      {KINDS.map((kind) => (
        <>
          <button type="button" data-button={kind} aria-label={kind}>
            {kind}
          </button>
          <button type="button" data-button={kind} aria-label={`${kind} disabled`} aria-disabled="true" title="why">
            {kind}
          </button>
        </>
      ))}
    </div>
  ));
  undrive = driveStates();

  return (kind: string, disabled = false) => document.querySelector<HTMLElement>(`[aria-label="${disabled ? `${kind} disabled` : kind}"]`)!;
};

const paint = (style: CSSStyleDeclaration) => `${style.getPropertyValue("background-color")}|${style.getPropertyValue("color")}`;

describe("u171 every kind shows every state", () => {
  it("u171_hover_differs_from_rest_and_pressed_from_hover_and_is_instant", () => {
    const button = fixture();

    for (const kind of KINDS) {
      const el = button(kind);

      expect(paint(styleIn(el, "hover")), `${kind} hover`).not.toBe(paint(styleIn(el, "rest")));
      expect(paint(styleIn(el, "pressed")), `${kind} pressed`).not.toBe(paint(styleIn(el, "hover")));
      expect(styleIn(el, "pressed").getPropertyValue("transition-duration"), kind).toBe("0s");
      expect(styleIn(el, "hover").getPropertyValue("cursor"), kind).toBe("pointer");
    }
  });

  it("u171_focus_is_the_one_ring_of_u133_and_no_ancestor_of_the_fixture_clips_it", () => {
    const button = fixture();

    for (const kind of KINDS) {
      const el = button(kind);

      expect(outlineRulesIn(el, "focus"), kind).toEqual(["[data-state-focus]"]);
      expect(styleIn(el, "focus").getPropertyValue("outline-width"), kind).toBe("2px");

      for (let up = el.parentElement; up; up = up.parentElement) expect(getComputedStyle(up).overflow, kind).not.toMatch(/hidden|clip|auto|scroll/);
    }
  });

  it("u171_disabled_keeps_aria_disabled_not_the_attribute_and_changes_nothing_under_the_pointer", () => {
    const button = fixture();

    for (const kind of KINDS) {
      const el = button(kind, true);

      expect(el.hasAttribute("disabled"), kind).toBe(false);
      expect(el.getAttribute("aria-disabled"), kind).toBe("true");
      expect(el.getAttribute("title"), kind).toBe("why");

      for (const state of ["rest", "hover", "pressed"] as const) {
        expect(styleIn(el, state).getPropertyValue("color"), `${kind} ${state}`).toBe("var(--disabled)");
        expect(styleIn(el, state).getPropertyValue("cursor"), `${kind} ${state}`).toBe("default");
        expect(styleIn(el, state).getPropertyValue("background-color"), `${kind} ${state}`).toBe(styleIn(el, "rest").getPropertyValue("background-color"));
      }
    }
  });

  it("u171_the_disabled_tone_is_4_5_to_1_on_the_ground_and_the_sunken_surface_in_both_schemes", () => {
    for (const dark of [false, true]) {
      const tokens = tokensOf(dark);

      for (const ground of ["ground", "sunken"]) expect(contrastRatio(tokens.get("disabled")!, tokens.get(ground)!), `${dark ? "dark" : "light"} ${ground}`).toBeGreaterThanOrEqual(4.5);

      expect(tokens.get("disabled")).not.toBe(tokens.get("grey"));
      expect(tokens.get("pressed")).not.toBe(tokens.get("hover"));
    }
  });

  it("u171_the_hit_area_is_24px_high_and_an_icon_button_is_a_24px_square", () => {
    const button = fixture();

    for (const kind of KINDS) expect(px(styleIn(button(kind), "rest").getPropertyValue("min-height")), kind).toBeGreaterThanOrEqual(24);

    const icon = getComputedStyle(button("icon"));

    expect([px(icon.width), px(icon.height)]).toEqual([24, 24]);
  });

  it("u171_no_two_hit_areas_in_one_row_overlap", () => {
    const sheets = Object.entries(import.meta.glob<string>("../**/*.css", { query: "?raw", import: "default", eager: true }));

    expect(sheets.length).toBeGreaterThan(5);

    // A hit area is its in-flow box (the 24 px floor above), so two in one row overlap only when a rule pulls a button out of flow, under its neighbour, or grows its hit area with a pseudo-element.
    for (const [file, css] of sheets)
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const buttons = selector!.split(",").filter((part) => /button/.test(part));

        for (const part of buttons) {
          expect(part, `${file} pseudo-element on a button`).not.toMatch(/::?(before|after)/);
          expect(body, `${file} ${part.trim()}`).not.toMatch(/margin[a-z-]*:\s*-|position:\s*(absolute|fixed)/);
        }
      }
  });

  it("u171_no_two_kinds_have_the_same_rest_style", () => {
    const button = fixture();

    const signature = (kind: string) => {
      const style = getComputedStyle(button(kind));

      return ["color", "display", "min-width", "width", "gap", "justify-content", "--button-inline"].map((property) => style.getPropertyValue(property)).join("|");
    };

    const all = KINDS.map(signature);

    expect(new Set(all).size).toBe(KINDS.length);
  });
});

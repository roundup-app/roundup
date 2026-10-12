import { describe, expect, it } from "vitest";
import { PANE_MIN, RAIL, SHELF, railEffective } from "../resize/widths";
import appStyles from "../styles.css?inline";

const rule = (selector: string) => {
  const start = appStyles.indexOf(`${selector} {`);

  return start < 0 ? "" : appStyles.slice(start, appStyles.indexOf("}", start));
};

const declared = (block: string, property: string) => new RegExp(`${property}:\\s*([^;]+);`).exec(block)?.[1];

describe("u430 an open Drawer narrows the centre", () => {
  it("u430_centre_ends_where_the_drawer_begins", () => {
    const open = rule('.window:has(.drawer[data-open="true"]) .columns');

    expect(declared(open, "padding-right")).toBe("var(--drawer-width)");
    expect(declared(rule(".drawer"), "width")).toBe("var(--drawer-width)");
  });

  it("u430_centre_and_drawer_share_one_motion", () => {
    expect(appStyles).toContain("transition: padding-right var(--duration-drawer) ease-out");
    expect(declared(rule(".window"), "--drawer-width")).toBeDefined();
    expect(declared(rule(".columns"), "position")).toBe("relative");
    expect(rule('.window[data-reduced-motion="true"] .columns')).toContain("transition: none");
  });

  it("u430_input_is_never_under_the_drawer", () => {
    expect(declared(rule(".window"), "--drawer-width")).toBe(
      "min(max(560px, calc(var(--shelf-span) + var(--space-5))), max(calc((100% - var(--rail-width)) / 2), calc(100% - var(--rail-width) - 388px)))",
    );

    // The same formula in numbers: the Drawer never reaches the Rail, never empties the centre, and leaves it 388 px wherever the window allows.
    for (const window of [640, 700, 900, 1102, 1280, 1600]) {
      const rail = railEffective(RAIL.fallback, window);
      const space = window - rail;
      const drawer = Math.min(Math.max(560, SHELF.fallback + 24), Math.max(space / 2, space - PANE_MIN));
      const centre = space - drawer;

      expect(drawer).toBeGreaterThan(0);
      expect(centre).toBeGreaterThan(0);
      expect(centre >= PANE_MIN || drawer <= space / 2 + 0.5 || drawer >= 560).toBe(true);
    }
  });

  it("u430_drawer_text_selects_and_pastes_into_the_input", () => {
    expect(rule(".drawer")).not.toContain("user-select");
  });
});

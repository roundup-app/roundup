import { describe, expect, it } from "vitest";
import { PANE_MIN, RAIL, SHELF, railEffective, shelfEffective } from "../resize/widths";
import appStyles from "../styles.css?inline";

const rule = (selector: string) => {
  const start = appStyles.indexOf(`${selector} {`);

  return start < 0 ? "" : appStyles.slice(start, appStyles.indexOf("}", start));
};

const declared = (block: string, property: string) => new RegExp(`${property}:\\s*([^;]+);`).exec(block)?.[1];

describe("u430 an open Drawer narrows the centre", () => {
  it("u430_centre_ends_where_the_drawer_begins", () => {
    const open = rule('.window:has(.drawer[data-open="true"]) .columns::after');

    expect(declared(open, "width")).toBe("var(--drawer-width)");
    expect(declared(rule(".drawer"), "width")).toBe("var(--drawer-width)");
  });

  it("u430_centre_and_drawer_share_one_motion", () => {
    expect(appStyles).toContain("transition: width var(--duration-drawer) ease-out");
    expect(declared(rule(".window"), "--drawer-width")).toBeDefined();
    expect(declared(rule(".columns"), "position")).toBe("relative");
    expect(rule('.window[data-reduced-motion="true"] .columns::after')).toContain("transition: none");
  });

  it("u430_input_is_never_under_the_drawer", () => {
    expect(declared(rule(".window"), "--drawer-width")).toContain("var(--drawer-floor)");
    expect(rule('.window:has(.drawer[data-open="true"]) .shelf-edge-slot')).toContain("visibility: hidden");

    // The same formula in numbers: the Drawer is never narrower than the Shelf and a step (U409), never reaches the Rail, and leaves the centre 388 px wherever the window allows.
    for (const window of [640, 700, 900, 1102, 1280, 1600]) {
      const rail = railEffective(RAIL.fallback, window);
      const space = window - rail;
      const shelf = shelfEffective(SHELF.fallback, window, rail);
      const floor = shelf + 24;
      const drawer = Math.min(Math.max(560, floor), Math.max(space / 2, space - PANE_MIN, floor), space);

      expect(drawer).toBeGreaterThanOrEqual(Math.min(floor, space));
      expect(drawer).toBeLessThanOrEqual(space);

      if (space - PANE_MIN >= floor) expect(space - drawer).toBeGreaterThanOrEqual(Math.min(PANE_MIN, space - floor));
    }
  });

  it("u430_drawer_text_selects_and_pastes_into_the_input", () => {
    expect(rule(".drawer")).not.toContain("user-select");
  });
});

import { describe, expect, it } from "vitest";
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
    expect(declared(rule(".window"), "--drawer-width")).toContain("- 388px");
  });

  it("u430_drawer_text_selects_and_pastes_into_the_input", () => {
    expect(rule(".drawer")).not.toContain("user-select");
  });
});

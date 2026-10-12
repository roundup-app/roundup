import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import styles from "../styles.css?inline";

afterEach(cleanup);

const rule = (selector: string) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);
  const found = [...sheet.cssRules].find((r): r is CSSStyleRule => r instanceof CSSStyleRule && r.selectorText === selector);

  return found?.cssText ?? "";
};

describe("u409 a Drawer covers the Shelf from the window's top to its foot", () => {
  it("u409_the_overlay_layer_spans_the_whole_window", () => {
    const overlay = rule(".overlay");

    expect(overlay).toContain("position: absolute");
    expect(overlay).toMatch(/inset: 0(px)?;/);
  });

  it("u409_the_drawer_is_wider_than_the_shelf_and_stops_at_the_rail", () => {
    const width = rule(".drawer");

    expect(width).toContain("var(--shelf-span) + var(--space-5)");
    expect(width).toContain("100% - var(--rail-width)");
  });

  it("u409_the_drawer_draws_one_leading_hairline_edge", () => {
    const drawer = rule(".drawer");

    expect(drawer).toContain("border-left-width: 1px");
    expect(drawer).not.toMatch(/border-(right|top|bottom)-width/);
  });
});

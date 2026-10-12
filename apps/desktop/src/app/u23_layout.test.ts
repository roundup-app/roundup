import { describe, expect, it } from "vitest";
import styles from "../styles.css?inline";

const effective = (css: string, selector: string, property: string) =>
  [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${selector}\\s*{([^}]*)}`, "g"))]
    .flatMap(([, body]) => [...(body ?? "").matchAll(new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g"))].map((m) => m[1]))
    .at(-1);

// U389 narrows U23 and U24: the Rail's width is the user's Token (252 to 480 px, 288 by default) and the centre keeps 388 px, at every window width.
describe("u23 column widths", () => {
  it("u23_the_rail_is_the_token_and_the_centre_keeps_a_floor_of_388px", () => {
    expect(effective(styles, "\\.window", "--rail-width")).toBeUndefined();
    expect(effective(styles, "\\.columns", "grid-template-columns")).toBe("var(--rail-width) minmax(388px, 1fr)");
  });
});

describe("u24 narrow window", () => {
  it("u24_no_width_changes_the_columns", () => {
    expect(styles).not.toContain("@media (max-width");
  });

  it("u24_the_shelf_still_overlays_and_the_rail_and_the_centre_keep_their_columns", () => {
    expect(effective(styles, "\\.shelf", "position")).toBe("absolute");
    expect(effective(styles, "\\.shelf", "grid-area")).toBeUndefined();
    expect(effective(styles, "\\.rail", "grid-area")).toBeUndefined();
    expect(effective(styles, "\\.centre", "grid-area")).toBeUndefined();
  });

  it("u24_the_drawer_leaves_the_rail_visible", () => {
    expect(effective(styles, "\\.drawer", "width")).toBe("min(max(560px, calc(var(--shelf-span) + var(--space-5))), calc(100% - var(--rail-width)))");
  });
});

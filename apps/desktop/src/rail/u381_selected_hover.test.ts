import { describe, expect, it } from "vitest";

const read = (glob: Record<string, string>) => Object.values(glob)[0] ?? "";

const tokens = read(
  import.meta.glob<string>("../tokens.css", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

const rail = read(
  import.meta.glob<string>("./styles.css", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

const ui = read(
  import.meta.glob<string>("../ui/Tree.css", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

const ink = read(
  import.meta.glob<string>("../ink/styles.css", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

const alpha = (css: string, name: string) =>
  css.match(new RegExp(`${name}: rgba\\([^)]*?([\\d.]+)\\)`))?.[1];

const [light = "", dark = ""] = tokens.split(
  "@media (prefers-color-scheme: dark)",
);

describe("u381 a selected row answers the pointer with a darker step", () => {
  it("u381_selected_hover_sits_strictly_between_selected_and_pressed_in_both_schemes", () => {
    for (const [css, expected] of [
      [light, "0.07"],
      [dark, "0.13"],
    ] as const) {
      const [hover, selected, selectedHover, pressed] = [
        "--hover",
        "--selected",
        "--selected-hover",
        "--pressed",
      ].map((name) => Number(alpha(css, name)));

      expect(alpha(css, "--selected-hover")).toBe(expected);
      expect(
        hover! < selected! &&
          selected! < selectedHover! &&
          selectedHover! < pressed!,
      ).toBe(true);
    }
  });

  it("u381_the_selected_rail_row_and_shelf_row_draw_the_bar_and_one_wash_in_each_state", () => {
    for (const [css, row, selected] of [
      [ui, '.app-tree [data-part="item"]', "[data-selected]"],
      [ink, ".shelf-row", '[data-selected="true"]'],
    ] as const) {
      expect(css).toContain(
        `${row}${selected}:hover {\n  background-image: linear-gradient(var(--accent), var(--accent)), linear-gradient(var(--selected-hover), var(--selected-hover));`,
      );
      expect(css).toContain(
        `${row}${selected}:active {\n  background-image: linear-gradient(var(--accent), var(--accent)), linear-gradient(var(--pressed), var(--pressed));`,
      );
    }
  });

  it("u381_the_rail_row_sets_no_background_colour_for_hover_or_press", () => {
    expect(rail).not.toMatch(
      /\.rail-row[^{]*:(hover|active)[^{]*\{[^}]*background-color/,
    );
  });
});

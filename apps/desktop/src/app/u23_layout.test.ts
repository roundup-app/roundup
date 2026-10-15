import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { createComponent, createSignal } from "solid-js";
import { Layout } from "./Layout";
import styles from "../styles.css?inline";

const effective = (css: string, selector: string, property: string) =>
  [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${selector}\\s*{([^}]*)}`, "g"))]
    .flatMap(([, body]) => [...(body ?? "").matchAll(new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);`, "g"))].map((m) => m[1]))
    .at(-1);

// U389 narrows U23 and U24: the Rail's width is the user's Token (252 to 480 px, 288 by default) and the centre keeps 388 px, at every window width.
describe("u23 column widths", () => {
  it("u23_the_rail_is_the_token_and_the_centre_keeps_a_floor_of_388px", () => {
    expect(effective(styles, "\\.window", "--rail-width")).toBeUndefined();
    expect(effective(styles, "\\.columns", "grid-template-columns")).toBe("var(--rail-width) minmax(var(--centre-min-width), 1fr)");
  });
});

describe("u24 narrow window", () => {
  it("u24_no_width_changes_the_columns", () => {
    expect(styles).not.toContain("@media (max-width");
  });

  it("u24_the_full_height_shelf_sits_outside_the_columns", () => {
    expect(effective(styles, "\\.shelf", "position")).toBe("absolute");
    expect(effective(styles, "\\.shelf", "grid-area")).toBeUndefined();
    expect(effective(styles, "\\.rail", "grid-area")).toBeUndefined();
    expect(effective(styles, "\\.centre", "grid-area")).toBeUndefined();
  });

  it("u24_the_drawer_leaves_the_rail_visible", () => {
    expect(effective(styles, "\\.window", "--drawer-span")).toBe("max(560px, calc(var(--shelf-span) + var(--space-5)))");
    expect(effective(styles, "\\.drawer", "width")).toBe("var(--drawer-span)");
  });
});

afterEach(cleanup);

it("u491_layout_binds_owned_panels_without_replacing_grid_or_visibility", () => {
  const [shown, setShown] = createSignal(true);
  const attached: HTMLElement[] = [];

  const { container } = render(() => createComponent(Layout, {
    header: "Header", rail: "Rail", centre: "Centre", shelf: "Shelf", overlay: null,
    get shelfPlacement() { return { open: shown(), rendered: shown(), shown: shown(), animated: false, onSettle() {} }; },
    splitter: {
      root: { ref: (element) => attached.push(element), id: "splitter-root", style: { display: "flex" }, "data-scope": "splitter", "data-part": "root" },
      rail: { id: "splitter-rail", style: { flex: "0 0 22.5%" }, "data-part": "panel", "data-ownedby": "splitter-root" },
      centre: { id: "splitter-centre", "data-part": "panel", "data-ownedby": "splitter-root" },
      shelf: { id: "splitter-shelf", "data-part": "panel", "data-ownedby": "splitter-root" },
    },
  }));

  const root = container.querySelector<HTMLElement>("#splitter-root")!;
  expect(root).not.toBeNull();
  expect(attached).toEqual([root]);
  expect([...root.querySelectorAll('[data-part="panel"][data-ownedby="splitter-root"]')].map((el) => el.id)).toEqual(["splitter-rail", "splitter-centre", "splitter-shelf"]);
  expect(root.style.display).toBe("");
  expect(container.querySelector<HTMLElement>("#splitter-rail")!.style.flex).toBe("");
  const shelf = container.querySelector<HTMLElement>("#splitter-shelf")!;
  expect(shelf.hidden).toBe(false);
  setShown(false);
  expect(shelf.hidden).toBe(true);
  expect(shelf.getAttribute("data-ownedby")).toBe("splitter-root");
});

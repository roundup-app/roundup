import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { runChecks } from "../testing/checks";
import { resolveToken, tokensFrom } from "../testing/contrast";
import { seedApp } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import inkCss from "../ink/styles.css?inline";
import padsCss from "../pads/styles.css?inline";
import railCss from "../rail/styles.css?inline";
import terminalCss from "../terminal/styles.css?inline";
import rowButtonCss from "../todos/rowButton.styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";

const tokens = tokensFrom(tokenCss);

const sheet = (() => {
  const style = document.createElement("style");
  style.textContent = [tokenCss, appCss, inkCss, padsCss, railCss, terminalCss, rowButtonCss, stripCss].join("\n");

  return style;
})();

afterEach(() => {
  sheet.remove();
  cleanup();
});

const openDrawer = async () => {
  document.head.prepend(sheet);
  const controls = seedApp("tree-40", Date.now());
  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);

  // A full button-role query computes styles across the tree; U441 adds scoped rules to that scan.
  const todo = await waitFor(() => {
    const row = document.querySelector<HTMLButtonElement>('[data-todo="5"] .todo-row-button');

    expect(row).not.toBeNull();

    return row!;
  });

  fireEvent.click(todo);
  await waitFor(() => expect(document.querySelector('aside[aria-label="Drawer"][data-open="true"] .todo-detail')).not.toBeNull());

  return screen.getByRole("complementary", { name: "Drawer" });
};

const read = (el: Element, property: string) => resolveToken(getComputedStyle(el).getPropertyValue(property), tokens);

// Fixture setup and computed-style reads can exceed 5 s under full-suite load
// (#1496; full-tree scans also exceeded 5 s in CI run 38321010723). Bound each
// observer at 30 s without extending the application waits in openDrawer or waitFor.
describe("u134 surfaces and depth", () => {
  it("u134_the_rail_and_shelf_are_sunken_and_the_pane_and_drawer_are_ground", async () => {
    const drawer = await openDrawer();

    for (const region of [".rail", ".shelf"]) expect(read(document.querySelector(region)!, "background-color"), region).toBe(tokens.get("sunken"));
    expect(read(document.querySelector(".centre")!, "background-color")).toBe(tokens.get("ground"));
    expect(read(drawer, "background-color")).toBe(tokens.get("ground"));
  }, 30_000);

  it("u134_surfaces_inside_the_rail_and_shelf_do_not_paint_a_second_ground", async () => {
    await openDrawer();
    const pinned = [".rail-actions", ".rail-tree > .ink", ".shelf .complete"].flatMap((selector) => [...document.querySelectorAll(selector)]);

    for (const el of pinned) expect(read(el, "background"), el.className).toBe(tokens.get("sunken"));
  }, 30_000);

  it("u134_no_border_is_wider_than_1px_or_any_colour_but_hairline", async () => {
    await openDrawer();

    // CI run 38321010723 hit 5 s here; read each element's style once for all four edges.
    for (const el of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(el);

      for (const side of ["top", "right", "bottom", "left"]) {
        if (style.getPropertyValue(`border-${side}-style`) in { none: 1, "": 1 }) continue;
        expect(resolveToken(style.getPropertyValue(`border-${side}-width`), tokens), el.className).toMatch(/^(0|0px|1px)$/);
        expect(style.getPropertyValue(`border-${side}-color`), el.className).toBe("var(--hairline)");
      }
    }

    expect(runChecks().D8.status).toBe("pass");
  }, 30_000);

  it("u134_only_the_drawer_has_a_box_shadow", async () => {
    const drawer = await openDrawer();
    const shadowed = [...document.body.querySelectorAll("*")].filter((el) => !["", "none"].includes(getComputedStyle(el).boxShadow));

    expect(shadowed).toEqual([drawer]);
    expect(getComputedStyle(drawer).boxShadow).toBe("var(--shadow-drawer)");

    fireEvent.click(screen.getByRole("button", { name: "Close", hidden: false }));
    await waitFor(() => expect(drawer.inert).toBe(true));
    expect(["", "none"]).toContain(getComputedStyle(drawer).boxShadow);
  }, 30_000);

  it("u134_no_backdrop_filter_element_has_another_inside_it", async () => {
    await openDrawer();
    const backdrop = (el: Element) => !["", "none"].includes(getComputedStyle(el).getPropertyValue("backdrop-filter"));

    // The same CI run timed out scanning descendants; each style needs only one read.
    const filtered = new Set([...document.body.querySelectorAll("*")].filter(backdrop));

    for (const el of filtered)
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement)
        expect(filtered.has(ancestor), el.className).toBe(false);
  }, 30_000);

  it("u134_the_drawer_floats_over_the_pane_so_the_terminal_does_not_resize", async () => {
    const drawer = await openDrawer();

    expect(getComputedStyle(drawer).position).toBe("absolute");
    expect(getComputedStyle(document.querySelector(".centre")!).position).not.toBe("absolute");
  }, 30_000);
});

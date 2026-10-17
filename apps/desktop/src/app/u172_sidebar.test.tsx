import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { mountTodos, todo } from "../todos/testHarness";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf, settled } from "../rail/railFixture";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import { resolveToken, tokensFrom } from "../testing/contrast";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import railCss from "../rail/styles.css?inline";
import uiCss from "../ui/styles.css?inline";
import buttonCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import rowCss from "../todos/rowButton.styles.css?inline";

let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  sheet?.remove();
  cleanup();
  localStorage.clear();
});

const styled = () => {
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = [tokenCss, appCss, uiCss, railCss, buttonCss, inkCss, rowCss].join("\n");
};

const mountApp = async (seed: SeedName) => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  styled();
  const controls = seedApp(seed, Date.now());

  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");

  return controls;
};

const rowControl = (item: Element) => item.querySelector(".rail-row")!;

const workstreams = () => screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("aria-expanded"));

describe("u172 the sidebar's hierarchy", () => {
  it("u403_a_workstream_row_reads_chevron_name_and_no_badge_value_or_head", async () => {
    await mountApp("tree-40");
    const rows = workstreams();

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const parts = [...row.querySelector(".line")!.children];
      const name = row.querySelector(".name")!.textContent!;
      const order = ["rail-chevron", "name"].map((part) => parts.findIndex((el) => el.classList.contains(part)));

      expect(order.every((at) => at >= 0), name).toBe(true);
      expect(order, name).toEqual([...order].sort((a, b) => a - b));
      expect(order[0], name).toBe(0);
      expect(row.querySelector('button[aria-label="Collapse"]')!.getAttribute("data-button")).toBe("icon");
      expect(row.querySelector(".badge, .value"), name).toBeNull();
    }

    expect(document.querySelector("[data-group]")).toBeNull();
    expect(getComputedStyle(workstreams()[0]!.querySelector(".name")!).fontWeight).toBe("600");
  });

  it("u403_the_door_action_takes_the_right_side_and_the_name_gives_way", async () => {
    await mountRail([workstream("g"), agent("a", "working", "w", { parent: "g" })]);

    expect(screen.queryByText(/^Start supervisor$/i)).toBeNull();
    fireEvent.mouseEnter(rowOf("g"));
    expect(screen.getByRole("button", { name: "Start supervisor" }).getAttribute("data-button")).toBe("icon");
    expect(screen.getByRole("button", { name: "Start supervisor" }).querySelector(".icon")).toBeTruthy();
    expect(railCss).toMatch(/\.name\s*\{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis/);
    fireEvent.mouseLeave(rowOf("g"));
    expect(screen.queryByText(/^Start supervisor$/i)).toBeNull();
  });

  it("u172_an_item_shows_a_grey_two_line_description_under_its_bold_title", async () => {
    styled();
    await mountTodos([todo(1, { title: "ship", body: "line one of the note" })]);
    const row = await screen.findByRole("button", { name: /#1 ship/ });
    const description = document.querySelector(".item-description")!;

    expect(description.textContent).toBe("line one of the note");
    expect(getComputedStyle(row).fontWeight).toBe("600");
    expect([getComputedStyle(description).color, getComputedStyle(description).fontSize, getComputedStyle(description).overflow]).toEqual(["var(--grey)", "var(--text-caption)", "hidden"]);
    expect(rowCss).toMatch(/\.item-description\s*\{[^}]*-webkit-line-clamp:\s*2/);
    expect(row.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("u172_an_item_with_no_body_draws_no_description", async () => {
    styled();
    await mountTodos([todo(1)]);

    expect(document.querySelector(".item-description")).toBeNull();
  });

  it("u172_one_selected_row_has_the_band_and_the_accent_bar_as_a_background_never_a_border", async () => {
    await mountApp("agents-10");
    fireEvent.click(screen.getAllByRole("treeitem")[1]!);
    await settled();

    const marked = [...document.querySelectorAll(".rail-row")].filter((row) => getComputedStyle(row).backgroundImage.includes("--accent"));
    const style = getComputedStyle(marked[0]!);

    expect(marked.map((row) => (row.closest("[role=treeitem]") ?? row).getAttribute("aria-selected"))).toEqual(["true"]);
    // U381: the band is a second background layer, so no background-color is set; the pointer left over the clicked row may have stepped it up.
    expect([style.backgroundColor, style.backgroundImage, style.backgroundSize, style.borderLeftWidth]).toEqual(["rgba(0, 0, 0, 0)", expect.stringMatching(/^linear-gradient\(var\(--accent\), var\(--accent\)\), linear-gradient\(var\(--selected(-hover)?\)/), "2px 100%, auto", "0px"]);
  });

  it("u172_a_block_is_told_from_the_one_above_by_space_3_and_a_hairline_that_is_no_border", async () => {
    await mountApp("tree-40");

    expect(railCss).toMatch(/\[role="tree"\] > \[data-part="branch"\]:not\(:first-child\)\s*\{\s*margin-top:\s*var\(--space-3\)/);
    expect(railCss).toMatch(/:not\(:first-child\) > \.rail-row::before\s*\{[^}]*height:\s*1px;[^}]*background-color:\s*var\(--hairline\)/);
    expect(getComputedStyle(workstreams()[1]!).borderTopStyle).toBe("none");
  });

  it("u172_the_rail_pads_sixteen_and_a_row_is_28_tall_at_least", async () => {
    await mountApp("tree-40");

    expect([getComputedStyle(document.querySelector(".rail-scroll")!).paddingLeft, getComputedStyle(document.querySelector(".rail-scroll")!).paddingRight]).toEqual(["0px", "0px"]);
    expect([getComputedStyle(rowControl(workstreams()[0]!)).paddingLeft, getComputedStyle(rowControl(workstreams()[0]!)).paddingRight]).toEqual(["var(--space-4)", "var(--space-4)"]);
    expect(Number.parseFloat(resolveToken(getComputedStyle(rowControl(workstreams()[0]!)).minHeight, tokensFrom(tokenCss)))).toBeGreaterThanOrEqual(28);
  });
});

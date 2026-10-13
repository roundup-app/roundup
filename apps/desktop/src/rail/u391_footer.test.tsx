import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import tokenCss from "../tokens.css?inline";
import appCss from "../styles.css?inline";
import railCss from "./styles.css?inline";
import buttonCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import designSystem from "../../../../docs/design-system.md?raw";

let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  sheet?.remove();
  cleanup();
  localStorage.clear();
});

const mountApp = async () => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = [tokenCss, appCss, railCss, buttonCss, inkCss].join("\n");
  const controls = seedApp("tree-40", Date.now());

  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findAllByRole("treeitem");

  return controls;
};

const rail = () => document.querySelector<HTMLElement>(".rail")!;

const footer = () => rail().querySelector<HTMLElement>(".rail-actions")!;

const button = () => footer().querySelector<HTMLElement>("button")!;

describe("u391 + new Workstream is fixed to the Rail's bottom edge", () => {
  it("u391_the_footer_is_outside_the_scroll_area", async () => {
    await mountApp();

    expect(rail().lastElementChild).toBe(footer());
    expect(button().parentElement).toBe(footer());
    expect(rail().querySelector(".rail-scroll")!.contains(footer())).toBe(false);
    expect(getComputedStyle(rail().querySelector(".rail-scroll")!).overflow).toBe("auto");
    expect(getComputedStyle(footer()).position).not.toBe("sticky");
  });

  it("u391_the_button_spans_the_rail_bottom", async () => {
    await mountApp();

    expect(getComputedStyle(rail()).display).toBe("flex");
    expect(getComputedStyle(rail()).flexDirection).toBe("column");
    expect(appCss).toMatch(/\.rail > :not\(\.rail-actions\)\s*{[^}]*padding-left: var\(--space-4\)/);
    expect(railCss).toMatch(/\.rail-actions > button\s*{[^}]*flex: 1/);
  });

  it("u391_scrolling_does_not_move_it", async () => {
    await mountApp();

    expect(railCss).not.toMatch(/\.rail-actions\s*{[^}]*position: (sticky|absolute|fixed)/);
    expect(railCss).not.toContain("scroll-margin-bottom");
  });

  it("u391_it_is_kind_add_with_a_28px_hit_area", async () => {
    await mountApp();

    expect(button().getAttribute("data-button")).toBe("add");
    expect(railCss).toMatch(/\.rail-actions > button\s*{[^}]*min-height: 28px/);
    expect(document.querySelectorAll(".rail [data-button=add]").length).toBeGreaterThan(0);
    expect([...document.querySelectorAll(".rail > .rail-actions button")]).toHaveLength(1);
  });

  it("u391_it_still_creates_selects_and_starts", async () => {
    const controls = await mountApp();

    fireEvent.click(button());
    await waitFor(() => expect(controls.app.calls.filter((call) => call.method === "rail.createWorkstream")).toHaveLength(1));
  });

  it("u391_the_design_system_names_it", () => {
    const row = designSystem.split("\n").find((line) => line.startsWith("| add |"))!;

    expect(row).toContain("Rail's bottom edge");
    expect(designSystem.split("\n").filter((line) => /^\| (add|quiet|row action|icon button|primary) \|/.test(line))).toHaveLength(5);
  });
});

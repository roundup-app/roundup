import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { App } from "../App";
import { seedApp } from "../testing/seeds";

afterEach(() => { cleanup(); localStorage.clear(); });

const mount = async () => {
  window.matchMedia ??= (media) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  render(() => <App app={seedApp("tree-40", Date.now()).app} reducedMotion={() => true} clock={Date.now} />);

  return within(await screen.findByRole("tablist", { name: "Shelf" })).getAllByRole("tab");
};

it("u465_tabs_reuse_the_rail_section_head", async () => {
  const tabs = await mount();
  expect(tabs.map(tab => tab.querySelector(".section-head > span")?.textContent)).toEqual(["Todos", "Pads"]);
  expect(tabs.map(tab => tab.querySelector(".section-head > svg")?.getAttribute("aria-hidden"))).toEqual(["true", "true"]);
  const source = readFileSync("src/shelf/Shelf.tsx", "utf8");
  expect(source).toContain('import { SectionHead } from "../ink/SectionHead"');
  expect(source).toContain("<SectionHead");
});

it("u465_heads_keep_tab_roles_focus_and_keys", async () => {
  const tabs = await mount();

  for (const [key, selected] of [["ArrowLeft", 1], ["ArrowRight", 0], ["End", 1], ["Home", 0]] as const) {
    const current = tabs.find(tab => tab.getAttribute("aria-selected") === "true")!;
    fireEvent.keyDown(current, { key });
    await Promise.resolve(); // Shelf.select queues focus; observing after its microtask preserves keyboard order.
    expect(document.activeElement).toBe(tabs[selected]);
    expect(tabs.map(tab => tab.tabIndex)).toEqual(selected === 0 ? [0, -1] : [-1, 0]);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[selected]!.id);
    expect(panel.querySelector(`section[aria-label="${selected === 0 ? "Todos" : "Pads"}"]`)).not.toBeNull();
    expect(tabs[selected]!.querySelectorAll("button, [tabindex]")).toHaveLength(0);
  }
});

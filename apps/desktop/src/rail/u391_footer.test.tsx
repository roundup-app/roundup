import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import railCss from "./styles.css?inline";
import buttonCss from "../buttons.css?inline";

let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  sheet?.remove();
  cleanup();
  localStorage.clear();
});

const mountApp = async () => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = [tokenCss, appCss, railCss, buttonCss].join("\n");
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
  });

  it("u391_it_is_kind_add", async () => {
    await mountApp();

    expect(button().getAttribute("data-button")).toBe("add");
    expect(document.querySelectorAll(".rail [data-button=add]").length).toBeGreaterThan(0);
    expect([...document.querySelectorAll(".rail > .rail-actions button")]).toHaveLength(1);
  });

  it("u391_it_still_creates_selects_and_starts", async () => {
    const controls = await mountApp();

    fireEvent.click(button());
    await waitFor(() => expect(controls.app.calls.filter((call) => call.method === "rail.createWorkstream")).toHaveLength(1));
  });

});

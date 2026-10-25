import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { underSettings } from "../testing/media";
import { resolveToken, tokensOf } from "../testing/contrast";
import type { Setting } from "../testing/media";
import { seedApp } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import inkCss from "../ink/styles.css?inline";
import padsCss from "../pads/styles.css?inline";
import railCss from "../rail/styles.css?inline";
import terminalCss from "../terminal/styles.css?inline";
import rowButtonCss from "../todos/rowButton.styles.css?inline";
import bubblesCss from "../bubbles/styles.css?inline";
import stripCss from "../header/strip.styles.css?inline";

const SHEETS = [tokenCss, appCss, inkCss, padsCss, railCss, terminalCss, rowButtonCss, stripCss, bubblesCss].join("\n");

const cssFor = (settings: Setting[]) => underSettings(SHEETS, settings);

let sheet: HTMLStyleElement | undefined;

let tokens: HTMLStyleElement | undefined;

let matchMedia: typeof window.matchMedia | undefined;

afterEach(() => {
  sheet?.remove();
  tokens?.remove();

  if (matchMedia) window.matchMedia = matchMedia;
  matchMedia = undefined;
  cleanup();
});

const mount = async (settings: Setting[]) => {
  tokens = document.head.appendChild(document.createElement("style"));
  tokens.dataset.viteDevId = "/src/tokens.css";
  tokens.textContent = underSettings(tokenCss, settings);
  sheet = document.head.appendChild(document.createElement("style"));
  // jsdom leaves duration references unresolved; use the existing resolver on the shipped Tokens.
  const resolved = getComputedStyle(document.documentElement);
  const values = new Map([...tokensOf(tokenCss).keys()].map(name => [name, resolved.getPropertyValue(`--${name}`).trim()]));
  sheet.textContent = underSettings([appCss, inkCss, padsCss, railCss, terminalCss, rowButtonCss, stripCss, bubblesCss].join("\n"), settings)
    .replace(/var\(--duration-[\w-]+\)/g, value => resolveToken(value, values));
  matchMedia = window.matchMedia;

  const feature = { dark: "prefers-color-scheme: dark", "more-contrast": "prefers-contrast: more", "reduced-transparency": "prefers-reduced-transparency: reduce", "reduced-motion": "prefers-reduced-motion: reduce" };
  window.matchMedia = (query) => ({
    matches: settings.some((setting) => query.includes(feature[setting])),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });

  const controls = seedApp("agents-10", Date.now());
  render(() => <App app={controls.app} reducedMotion={() => settings.includes("reduced-motion")} clock={Date.now} />);
  await screen.findAllByRole("treeitem");
};

describe("u135 schemes", () => {
  it("u135_reduced_transparency_removes_every_backdrop_filter", async () => {
    await mount(["reduced-transparency"]);
    const rules = [...(sheet?.sheet?.cssRules ?? [])].filter((rule): rule is CSSStyleRule => "selectorText" in rule);
    const defaults = document.createElement("style");
    defaults.textContent = cssFor([]);
    document.head.appendChild(defaults);

    const filters = [...(defaults.sheet?.cssRules ?? [])].filter((rule): rule is CSSStyleRule => "selectorText" in rule)
      .filter((rule) => rule.style.getPropertyValue("backdrop-filter") && rule.style.getPropertyValue("backdrop-filter") !== "none");

    for (const filter of filters) {
      expect(rules.some(rule => rule.selectorText === filter.selectorText && rule.style.getPropertyValue("backdrop-filter") === "none"), filter.selectorText).toBe(true);
    }

    expect(filters.length).toBeGreaterThan(0);
    defaults.remove();
  });

  it("u135_reduced_motion_makes_every_duration_but_the_instant_changes_0s", async () => {
    await mount(["reduced-motion"]);

    for (const el of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(el);

      for (const duration of [style.transitionDuration, style.animationDuration]) expect(duration.split(",").every((one) => one.trim() === "" || one.trim() === "auto" || /^0m?s$/.test(one.trim())), `${el.className} ${duration}`).toBe(true);
    }
  });
});

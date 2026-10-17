import { leaderKey } from "../keys/leaderFixture";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import railCss from "../rail/styles.css?inline";
import buttonCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import shelfCss from "../shelf/styles.css?inline";
import { RAIL, SHELF, railEffective, shelfEffective } from "./widths";

let sheet: HTMLStyleElement | undefined;

afterEach(() => {
  sheet?.remove();
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const mountApp = async (seed: SeedName = "tree-40") => {
  window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = [tokenCss, appCss, railCss, buttonCss, inkCss, shelfCss].join("\n");
  const controls = seedApp(seed, Date.now());

  render(() => <App app={controls.app} reducedMotion={() => true} clock={Date.now} />);
  await screen.findByRole("tablist", { name: "Work items" });

  return controls;
};

const shelfEdge = () => screen.getByRole("separator", { name: "Resize work items" });

const windowEl = () => document.querySelector<HTMLElement>(".window")!;

const railWidth = () => windowEl().style.getPropertyValue("--rail-width");

const shelfSpan = () => windowEl().style.getPropertyValue("--shelf-span");

const valueOf = (edge: HTMLElement) => Number(edge.getAttribute("aria-valuenow"));

describe("u389 the Rail's width is the user's", () => {
  it("u389_default_is_288_wider_than_252", async () => {
    await mountApp();

    expect(railWidth()).toBe("288px");
    expect(RAIL.fallback).toBeGreaterThan(RAIL.min);
    expect(tokenCss).toContain(`--rail-width: ${RAIL.fallback}px`);
    expect(tokenCss).toContain(`--shelf-width: ${SHELF.fallback}px`);
  });

  it("u453_widths_keep_resize_bounds_without_window_clamps", async () => {
    Object.assign(window, { innerWidth: 1280 });

    for (const [stored, rail, shelf] of [[100, 252, 240], [360, 360, 360], [9999, 480, 560]] as const) {
      expect(railEffective(stored)).toBe(rail);
      expect(shelfEffective(stored)).toBe(shelf);
    }
  });

  it("u389_a_bad_stored_width_means_the_default", async () => {
    for (const rail of ["wide", null, Number.NaN]) {
      localStorage.setItem("roundup:widths:/Users/you/harness", JSON.stringify({ rail, shelf: 320 }));
      await mountApp();
      expect(railWidth(), String(rail)).toBe("288px");
      cleanup();
      sheet?.remove();
    }

    localStorage.setItem("roundup:widths:/Users/you/harness", JSON.stringify({ rail: 9999, shelf: 320 }));
    await mountApp();
    expect(railWidth()).toBe("480px");
  });

  it("u389_the_columns_clip_sideways_overflow", async () => {
    await mountApp();
    expect(appCss).toMatch(/\.columns\s*{[^}]*overflow-x: clip/);
    expect(appCss).toMatch(/--drawer-span: max\(560px, calc\(var\(--shelf-span\) \+ var\(--space-5\)\)\);/);
  });
});

describe("u390 the Shelf's width is the user's", () => {
  it("u390_default_is_320", async () => {
    await mountApp();

    expect(shelfSpan()).toBe("320px");
    expect(valueOf(shelfEdge())).toBe(320);
  });

  it("u390_closed_has_no_edge", async () => {
    await mountApp();
    leaderKey("KeyS");
    await waitFor(() => expect(document.querySelector(".shelf-edge-slot")!.hasAttribute("hidden")).toBe(true));
    expect(screen.queryByRole("separator", { name: "Resize work items" })).toBeNull();
  });
});

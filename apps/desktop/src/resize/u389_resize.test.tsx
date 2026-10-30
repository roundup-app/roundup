import { leaderKey } from "../keys/leaderFixture";
import { cleanup, render, renderHook, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { seedApp } from "../testing/seeds";
import type { SeedName } from "../testing/seeds";
import tokenCss from "../tokens.css?raw";
import appCss from "../styles.css?inline";
import railCss from "../rail/styles.css?inline";
import buttonCss from "../buttons.css?inline";
import inkCss from "../ink/styles.css?inline";
import shelfCss from "../shelf/styles.css?inline";
import { createWidths, railEffective, shelfEffective } from "./widths";

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
  await screen.findByRole("tablist", { name: "Bench" });

  return controls;
};

const shelfEdge = () => screen.getByRole("separator", { name: "Resize Bench" });

const windowEl = () => document.querySelector<HTMLElement>(".window")!;

const railWidth = () => windowEl().style.getPropertyValue("--rail-width");

const shelfSpan = () => windowEl().style.getPropertyValue("--shelf-span");

const valueOf = (edge: HTMLElement) => Number(edge.getAttribute("aria-valuenow"));

describe("u389 the Rail's width is the user's", () => {
  it("u389_default_is_288_wider_than_252", async () => {
    await mountApp();

    expect(railWidth()).toBe("288px");
  });

  it("u453_widths_keep_resize_bounds_without_window_clamps", () => {
    Object.assign(window, { innerWidth: 1280 });

    for (const [stored, rail, shelf] of [[100, 252, 240], [360, 360, 360], [9999, 480, 560]] as const) {
      expect(railEffective(stored)).toBe(rail);
      expect(shelfEffective(stored)).toBe(shelf);
    }
  });

  it("u389_a_bad_stored_width_means_the_default", () => {
    // JSON.stringify(NaN) is null; 1e400 exercises a parsed non-finite number.
    for (const rail of ['"wide"', "null", "1e400"]) {
      localStorage.setItem("roundup:widths:/Users/you/harness", `{"rail":${rail},"shelf":320}`);
      const { result, cleanup: dispose } = renderHook(() => createWidths(() => "/Users/you/harness"));

      expect(result.rail.now(), rail).toBe(288);
      dispose();
    }

    localStorage.setItem("roundup:widths:/Users/you/harness", JSON.stringify({ rail: 9999, shelf: 320 }));
    const { result } = renderHook(() => createWidths(() => "/Users/you/harness"));

    expect(result.rail.now()).toBe(480);
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
    leaderKey("KeyB");
    await waitFor(() => expect(document.querySelector(".shelf-edge-slot")!.hasAttribute("hidden")).toBe(true));
    expect(screen.queryByRole("separator", { name: "Resize Bench" })).toBeNull();
  });
});

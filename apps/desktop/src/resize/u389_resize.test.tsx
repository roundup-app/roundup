import { leaderKey } from "../keys/leaderFixture";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
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

const railEdge = () => screen.getByRole("separator", { name: "Resize Rail" });

const shelfEdge = () => screen.getByRole("separator", { name: "Resize work items" });

const windowEl = () => document.querySelector<HTMLElement>(".window")!;

const railWidth = () => windowEl().style.getPropertyValue("--rail-width");

const shelfSpan = () => windowEl().style.getPropertyValue("--shelf-span");

const valueOf = (edge: HTMLElement) => Number(edge.getAttribute("aria-valuenow"));

const pointer = (target: Element, type: string, clientX: number) => target.dispatchEvent(new MouseEvent(type, { clientX, button: 0, bubbles: true, cancelable: true }));

const drag = async (edge: HTMLElement, from: number, to: number) => {
  pointer(edge, "pointerdown", from);
  pointer(edge, "pointermove", to);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  pointer(edge, "pointerup", to);
};

// SAFETY: the tests above store this shape.
const stored = () => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith("roundup:widths:"))!)!) as { rail: number; shelf: number };

describe("u389 the Rail's width is the user's", () => {
  it("u389_default_is_288_wider_than_252", async () => {
    await mountApp();

    expect(railWidth()).toBe("288px");
    expect(RAIL.fallback).toBeGreaterThan(RAIL.min);
    expect(tokenCss).toContain(`--rail-width: ${RAIL.fallback}px`);
    expect(tokenCss).toContain(`--shelf-width: ${SHELF.fallback}px`);
  });

  it("u389_the_edge_is_a_focusable_separator_with_values", async () => {
    await mountApp();

    expect(railEdge().getAttribute("aria-orientation")).toBe("vertical");
    expect(railEdge().tabIndex).toBe(0);
    expect(railEdge().getAttribute("aria-valuenow")).toBe("288");
    expect(railEdge().getAttribute("aria-valuemin")).toBe("252");
    expect(railEdge().getAttribute("aria-valuemax")).toBe("480");
  });

  it("u453_widths_keep_resize_bounds_without_window_clamps", async () => {
    Object.assign(window, { innerWidth: 1280 });

    for (const [stored, rail, shelf] of [[100, 252, 240], [360, 360, 360], [9999, 480, 560]] as const) {
      expect(railEffective(stored)).toBe(rail);
      expect(shelfEffective(stored)).toBe(shelf);
    }

    await mountApp();
    fireEvent.keyDown(railEdge(), { key: "End" });
    fireEvent.keyDown(shelfEdge(), { key: "End" });
    cleanup();
    sheet?.remove();
    await mountApp();
    expect([valueOf(railEdge()), valueOf(shelfEdge())]).toEqual([480, 560]);
  });

  it("u389_a_drag_sets_the_width_and_clamps", async () => {
    await mountApp();

    await drag(railEdge(), 288, 360);
    await waitFor(() => expect(railWidth()).toBe("360px"));
    expect(valueOf(railEdge())).toBe(360);

    await drag(railEdge(), 360, 900);
    expect(valueOf(railEdge())).toBe(480);

    await drag(railEdge(), 480, 10);
    expect(valueOf(railEdge())).toBe(252);
  });

  it("u389_keys_step_and_jump", async () => {
    await mountApp();

    fireEvent.keyDown(railEdge(), { key: "ArrowRight" });
    expect(valueOf(railEdge())).toBe(304);
    fireEvent.keyDown(railEdge(), { key: "ArrowRight", shiftKey: true });
    expect(valueOf(railEdge())).toBe(368);
    fireEvent.keyDown(railEdge(), { key: "Home" });
    expect(valueOf(railEdge())).toBe(252);
    fireEvent.keyDown(railEdge(), { key: "End" });
    expect(valueOf(railEdge())).toBe(480);
  });

  it("u389_double_click_and_enter_reset", async () => {
    await mountApp();

    fireEvent.keyDown(railEdge(), { key: "End" });
    fireEvent.dblClick(railEdge());
    expect(valueOf(railEdge())).toBe(288);
    fireEvent.keyDown(railEdge(), { key: "Home" });
    fireEvent.keyDown(railEdge(), { key: "Enter" });
    expect(valueOf(railEdge())).toBe(288);
  });

  it("u389_escape_cancels_a_drag", async () => {
    await mountApp();

    pointer(railEdge(), "pointerdown", 288);
    pointer(railEdge(), "pointermove", 400);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(railWidth()).toBe("400px");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(railWidth()).toBe("288px");
    pointer(railEdge(), "pointerup", 400);
    expect(valueOf(railEdge())).toBe(288);
    expect(localStorage.getItem("roundup:widths:/Users/you/harness")).toBeNull();
  });

  it("u389_a_drag_writes_style_once_per_frame", async () => {
    await mountApp();
    const write = vi.spyOn(windowEl().style, "setProperty");

    pointer(railEdge(), "pointerdown", 288);

    for (const x of [300, 310, 320, 330]) pointer(railEdge(), "pointermove", x);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(write.mock.calls.filter(([name]) => name === "--rail-width")).toHaveLength(1);
    pointer(railEdge(), "pointerup", 330);
  });

  it("u389_the_terminal_fits_once_when_the_drag_ends", async () => {
    const controls = await mountApp();

    const resizes = () => controls.app.calls.filter((call) => call.method === "terminal.resize").length;

    const before = resizes();

    pointer(railEdge(), "pointerdown", 288);
    pointer(railEdge(), "pointermove", 360);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(resizes()).toBe(before);
    pointer(railEdge(), "pointerup", 360);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(resizes() - before).toBeLessThanOrEqual(1);
  });

  it("u389_the_width_survives_a_restart_per_project", async () => {
    const first = await mountApp();

    await drag(railEdge(), 288, 360);
    expect(stored().rail).toBe(360);

    cleanup();
    render(() => <App app={first.app} reducedMotion={() => true} clock={Date.now} />);
    await screen.findAllByRole("treeitem");
    expect(railWidth()).toBe("360px");
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

  it("u389_a_drag_keeps_u111", async () => {
    await mountApp();
    const scrolled = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

    await drag(railEdge(), 288, 400);
    expect(scrolled).not.toHaveBeenCalled();
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

  it("u390_the_edge_is_a_focusable_separator", async () => {
    await mountApp();

    expect(shelfEdge().tabIndex).toBe(0);
    expect(shelfEdge().getAttribute("aria-valuemin")).toBe("240");
    expect(shelfEdge().getAttribute("aria-valuemax")).toBe("560");
  });

  it("u390_a_drag_widens_leftward_and_clamps", async () => {
    await mountApp();

    await drag(shelfEdge(), 700, 600);
    expect(valueOf(shelfEdge())).toBe(420);
    await drag(shelfEdge(), 600, 0);
    expect(valueOf(shelfEdge())).toBe(560);
    await drag(shelfEdge(), 0, 900);
    expect(valueOf(shelfEdge())).toBe(240);
  });

  it("u390_the_rail_is_never_covered", async () => {
    await mountApp();
    fireEvent.keyDown(shelfEdge(), { key: "End" });
    fireEvent.keyDown(railEdge(), { key: "End" });

    expect(valueOf(shelfEdge())).toBe(560);
    expect(stored().shelf).toBe(560);
  });

  it("u390_a_drag_sends_no_call", async () => {
    const controls = await mountApp();

    const before = controls.app.calls.length;

    await drag(shelfEdge(), 700, 600);
    expect(controls.app.calls.length).toBe(before);
    expect(railWidth()).toBe("288px");
  });

  it("u390_closed_has_no_edge", async () => {
    await mountApp();
    leaderKey("KeyS");
    await waitFor(() => expect(document.querySelector(".shelf-edge-slot")!.hasAttribute("hidden")).toBe(true));
    expect(screen.queryByRole("separator", { name: "Resize work items" })).toBeNull();
  });

  it("u390_the_width_survives_a_restart_per_project", async () => {
    const first = await mountApp();

    fireEvent.keyDown(shelfEdge(), { key: "ArrowLeft", shiftKey: true });
    expect(valueOf(shelfEdge())).toBe(384);
    expect(stored().shelf).toBe(384);

    cleanup();
    render(() => <App app={first.app} reducedMotion={() => true} clock={Date.now} />);
    await screen.findAllByRole("treeitem");
    expect(shelfSpan()).toBe("384px");
  });

  it("u390_keys_reset_and_escape", async () => {
    await mountApp();

    fireEvent.keyDown(shelfEdge(), { key: "ArrowLeft" });
    expect(valueOf(shelfEdge())).toBe(336);
    fireEvent.keyDown(shelfEdge(), { key: "ArrowRight" });
    expect(valueOf(shelfEdge())).toBe(320);
    fireEvent.keyDown(shelfEdge(), { key: "Home" });
    expect(valueOf(shelfEdge())).toBe(240);
    fireEvent.dblClick(shelfEdge());
    expect(valueOf(shelfEdge())).toBe(320);
    pointer(shelfEdge(), "pointerdown", 700);
    pointer(shelfEdge(), "pointermove", 600);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(shelfSpan()).toBe("320px");
  });
});

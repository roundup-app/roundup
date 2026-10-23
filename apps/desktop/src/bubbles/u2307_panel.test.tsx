import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { event } from "../testing/nodes";
import { bubbleCalls, mountBubbles } from "./bubblesFixture";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(cleanup);

const bubble = (): HTMLElement | null => document.querySelector<HTMLElement>(".bubble:not([hidden])");

const shown = async () => {
  const listeners = vi.spyOn(document, "addEventListener");
  const mounted = await mountBubbles("w", []);

  mounted.setListed([{ ...(await import("../testing/nodes")).info("1", { owner: "w", title: "zsh" }) }]);
  listeners.mockClear();
  mounted.app.emit(event({ name: "terminal.changed" }));
  await waitFor(() => expect(bubble()).not.toBeNull());
  // Panel uses Ark Dialog's dismissable layer. @zag-js/interact-outside's
  // trackInteractOutsideImpl registers pointerdown in a zero-delay timer;
  // visible content alone does not mean the layer can receive the next press.

  try {
    await waitFor(() => expect(listeners.mock.calls.some(([type]) => type === "pointerdown")).toBe(true));
  } finally {
    listeners.mockRestore();
  }

  // Zag's layerStack.remove retains recentlyRemoved through nextTick (two
  // animation frames), during which isInNestedLayer suppresses outside presses.
  await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

  return mounted;
};

it.each([".pane", ".resource-strip", ".terminal-new", ".rail-row"])("u2307a_an_outside_press_minimises_and_still_reaches_its_target (%s)", async (target) => {
  await shown();

  const outside = document.querySelector<HTMLElement>(target)!;
  let reached = 0;

  outside.addEventListener("pointerdown", () => reached++);
  fireEvent.pointerDown(outside, { button: 0, pointerType: "mouse" });
  await waitFor(() => expect(bubble()).toBeNull());
  expect(reached).toBe(1);
  fireEvent.pointerDown(outside, { button: 0, pointerType: "mouse" });
  await new Promise((done) => setTimeout(done, 20));
  expect(bubble()).toBeNull();
  expect(reached).toBe(2);
});

it("u2307a_a_press_inside_or_on_its_own_tab_does_not_minimise", async () => {
  await shown();
  fireEvent.pointerDown(bubble()!.querySelector(".bubble-body")!, { button: 0, pointerType: "mouse" });
  fireEvent.pointerDown(document.querySelector(".terminal-tab")!, { button: 0, pointerType: "mouse" });
  fireEvent.pointerDown(document.body, { button: 2, pointerType: "mouse" });
  await new Promise((done) => setTimeout(done, 50));
  expect(bubble()).not.toBeNull();
});

it("u2307a_escape_and_other_keys_still_reach_the_terminal", async () => {
  await shown();

  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

  bubble()!.querySelector<HTMLElement>(".bubble-body [tabindex]")!.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(false);
  expect(bubble()).not.toBeNull();
});

it("u2307a_a_minimised_bubble_keeps_its_place_and_size_and_restores", async () => {
  await shown();

  const style = bubble()!.getAttribute("style");

  fireEvent.pointerDown(document.body, { button: 0, pointerType: "mouse" });
  await waitFor(() => expect(bubble()).toBeNull());
  fireEvent.click(document.querySelector(".terminal-tab")!);
  await waitFor(() => expect(bubble()).not.toBeNull());
  expect(bubble()!.getAttribute("style")).toBe(style);
});

it("u2307b_the_bubble_is_a_library_layer_and_no_z_index_orders_it", async () => {
  await shown();

  const frame = bubble()!.closest<HTMLElement>(".bubble-frame")!;

  expect(frame.parentElement!.parentElement).toBe(document.body);
  expect(frame.getAttribute("popover")).toBe("manual");
  expect(frame.dataset.scope).toBe("dialog");
  expect(frame.getAttribute("aria-modal")).toBe("false");
  expect(document.querySelector(".centre-stack")!.contains(frame)).toBe(false);

  for (const node of [frame, bubble()!]) expect(node.style.zIndex).toBe("");
});

it("u2307b_the_portal_keeps_the_place_and_the_pane_size", async () => {
  await shown();

  const before = document.querySelector(".pane")!.outerHTML;
  const place = bubble()!.style.cssText;

  fireEvent.pointerDown(document.body, { button: 0, pointerType: "mouse" });
  await waitFor(() => expect(bubble()).toBeNull());
  fireEvent.click(document.querySelector(".terminal-tab")!);
  await waitFor(() => expect(bubble()).not.toBeNull());
  expect(document.querySelector(".pane")!.outerHTML).toBe(before);
  expect(bubble()!.style.cssText).toBe(place);
});

it("u2307c_the_dots_name_and_call_close_and_minimise", async () => {
  const mounted = await shown();
  const dots = [...bubble()!.querySelectorAll<HTMLButtonElement>(".bubble-header button")];

  expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual(["Close", "Minimise"]);
  expect(dots.every((dot) => dot.tagName === "BUTTON" && dot.textContent === "")).toBe(true);
  fireEvent.click(dots[1]!);
  await waitFor(() => expect(bubble()).toBeNull());
  fireEvent.click(document.querySelector(".terminal-tab")!);
  await waitFor(() => expect(bubble()).not.toBeNull());
  fireEvent.click(bubble()!.querySelector('[aria-label="Close"]')!);
  await waitFor(() => expect(bubbleCalls(mounted.app, "terminal.close")).toEqual([{ id: "1" }]));
});

it("u2307c_the_bar_keeps_drag_fill_and_keyboard_moves", async () => {
  await shown();

  const header = bubble()!.querySelector<HTMLElement>(".bubble-header")!;
  const before = bubble()!.style.left;

  header.focus();
  fireEvent.keyDown(header, { key: "ArrowRight" });
  await waitFor(() => expect(bubble()!.style.left).not.toBe(before));
  fireEvent.dblClick(header);
  await waitFor(() => expect(bubble()!.style.width).not.toBe("600px"));
});

it("u2307a_focus_moving_to_a_control_outside_minimises_the_bubble", async () => {
  await shown();

  const inside = bubble()!.querySelector<HTMLElement>(".bubble-body [tabindex]")!;
  const outside = document.body.appendChild(document.createElement("input"));

  inside.focus();
  outside.focus();
  await waitFor(() => expect(bubble()).toBeNull());
});

it("u2307a_focus_landing_outside_an_open_bubble_minimises_it_without_prior_focus_inside", async () => {
  await shown();

  const outside = document.body.appendChild(document.createElement("input"));

  outside.focus();
  await waitFor(() => expect(bubble()).toBeNull());
});

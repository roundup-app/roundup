import { createRoot } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { focusTarget, layerOpen, provideFocusTarget } from "./focus";

afterEach(() => { document.body.replaceChildren(); });

const provided = (element: HTMLElement) => createRoot(dispose => {
  provideFocusTarget("terminal.new", element);

  return dispose;
});

const attached = (tag = "button") => document.body.appendChild(document.createElement(tag));

it("u524_focus_target_last_provider_wins_and_an_older_cleanup_keeps_the_newer", () => {
  const first = attached();
  const second = attached();
  const stopFirst = provided(first);
  const stopSecond = provided(second);

  expect(focusTarget("terminal.new")).toBe(second);
  stopFirst();

  expect(focusTarget("terminal.new")).toBe(second);
  stopSecond();
  expect(focusTarget("terminal.new")).toBeUndefined();
  expect(focusTarget("ask.input")).toBeUndefined();
});

it("u524_each_open_layer_counts_as_open_and_a_drag_only_when_asked", () => {
  expect(layerOpen()).toBe(false);

  for (const markup of ['<div class="drawer" data-open="true"></div>', "<div role=dialog></div>", "<div role=alertdialog></div>", "<div role=menu></div>"]) {
    document.body.innerHTML = markup;
    expect(layerOpen(), markup).toBe(true);
  }

  document.body.innerHTML = '<div class="drawer" data-open="false"></div><div data-dnd-dragging></div>';
  expect(layerOpen()).toBe(false);
  expect(layerOpen(true)).toBe(true);
});

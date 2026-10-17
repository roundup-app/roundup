import { cleanup } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { registerKeys } from "../keys/registry";
import { bubbleChord, mountBubbles } from "./bubblesFixture";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });

afterEach(cleanup);

const shown = () => [...document.querySelectorAll(".bubble:not([hidden])")].map((bubble) => bubble.getAttribute("data-bubble"));

it("u501_shortcuts_follow_focus", async () => {
  await mountBubbles();

  const before = shown();

  // A modal layer (Help) owns the chord, so the Bubble action underneath does not run.
  const panel = document.body.appendChild(document.createElement("div"));
  let open = true;
  const pressed: string[] = [];

  const dispose = createRoot((stop) => {
    registerKeys({ kind: "layer", element: () => panel, active: () => open, modal: true }, [{ chords: ["Meta+KeyB"], run: () => pressed.push("layer") }]);

    return stop;
  });

  bubbleChord("b");
  expect([pressed, shown()]).toEqual([["layer"], before]);

  // Once the layer closes, the registry hands the chord back to the Bubble.
  open = false;
  bubbleChord("b");
  expect(pressed).toEqual(["layer"]);
  expect(shown()).not.toEqual(before);

  dispose();
  panel.remove();
});

it("u501_disposal_leaves_no_stale_bubble_callback", async () => {
  await mountBubbles();
  cleanup();

  const event = bubbleChord("b");

  expect(event.defaultPrevented).toBe(false);
  expect(shown()).toEqual([]);
});

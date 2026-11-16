import { createRoot, createSignal, flush } from "solid-js";
import { expect, it } from "vitest";
import { createShelfFrame } from "./frame";

it("u3010b_shelf_preference_change_settles_the_slide", () => {
  const [reduced, setReduced] = createSignal(false);
  const { frame, dispose } = createRoot(dispose => ({ frame: createShelfFrame(() => "/p", reduced, () => {}), dispose }));

  // Closing by pointer: the box stays in the layout while it slides.
  frame.toggle("pointer");
  flush();
  expect(frame.open()).toBe(false);
  expect(frame.rendered()).toBe(true);
  expect(frame.animated()).toBe(true);

  // Reduced motion mid-slide: out of the layout now, with nothing left to animate.
  setReduced(true);
  flush();
  expect(frame.rendered()).toBe(false);
  expect(frame.animated()).toBe(false);

  // Turning it off replays nothing; the next pointer toggle animates again.
  setReduced(false);
  flush();
  expect(frame.rendered()).toBe(false);
  expect(frame.animated()).toBe(false);
  frame.toggle("pointer");
  flush();
  expect(frame.open()).toBe(true);
  expect(frame.animated()).toBe(true);
  dispose();
});

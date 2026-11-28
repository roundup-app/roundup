import { createRoot, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { createWidths } from "../resize/widths";
import { layoutMoving, layoutRested } from "../resize/motion";
import { railView, createRailSlide } from "./slide";
import { setRailAtStart, setRailSliding } from "./sliding";

const getAnimations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");

afterEach(() => {
  if (getAnimations) Object.defineProperty(Element.prototype, "getAnimations", getAnimations);
  else Reflect.deleteProperty(Element.prototype, "getAnimations");

  document.body.replaceChildren();
  setRailAtStart(false);
  setRailSliding(false);
});

/** A browser that slides: a `.rail-body` whose animations never finish. */
const sliding = () => {
  const body = document.createElement("div");

  body.className = "rail-body";
  document.body.append(body);
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [{ finished: new Promise(() => {}) }] });

  const made = createRoot(() => {
    const widths = createWidths(() => "/p");

    return { widths, slide: createRailSlide(widths, () => false) };
  });

  flush();

  return made;
};

it("u8075_the_fold_gives_the_centre_its_final_width_at_the_click", async () => {
  const { widths, slide } = sliding();

  slide.set(true, "click", false, true);
  await Promise.resolve();
  flush();
  expect(widths.laidOut()).toBe(true);
  expect(slide.motion()).toBe("fold");
  expect(railView(widths, undefined)).toEqual({ strip: true, peek: false });
  expect(layoutMoving()).toBe(false);

  slide.set(false, "click", true, true);
  flush();
  expect(widths.laidOut()).toBe(false);
  expect(railView(widths, undefined)).toEqual({ strip: true, peek: true });
});

it("u8075_the_landing_diff_draws_while_the_fold_slides", async () => {
  const { slide } = sliding();

  slide.set(true, "click", false, true);
  await Promise.resolve();
  flush();
  await layoutRested();

  slide.set(false, "click");
  await Promise.resolve();
  flush();
  expect(layoutMoving()).toBe(true);
});

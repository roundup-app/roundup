// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { curveOf, durationMs, easingOutCurve } from "./reorderMotion";

const root = document.documentElement;

afterEach(() => root.removeAttribute("style"));

test("u7396a_a_duration_token_reads_in_ms_and_the_curve_parses", () => {
  root.style.setProperty("--duration-a", "0.2s");
  root.style.setProperty("--duration-b", "180ms");
  root.style.setProperty("--duration-c", "soon");
  root.style.setProperty("--easing-out", "cubic-bezier(0.32, 0.72, 0, 1)");

  expect(durationMs("--duration-a")).toBe(200);
  expect(durationMs("--duration-b")).toBe(180);
  expect(durationMs("--duration-c")).toBe(0);
  expect(durationMs("--duration-missing")).toBe(0);
  expect(easingOutCurve()).toEqual([0.32, 0.72, 0, 1]);
  expect(curveOf("--easing-out", root)).toEqual([0.32, 0.72, 0, 1]);
});

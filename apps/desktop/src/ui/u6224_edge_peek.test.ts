import { createRoot } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEdgePeek, PEEK_DWELL } from "./edgePeek";

const strip = document.createElement("div");

strip.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 100, width: 40, height: 400 });

let dispose = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.append(strip);
});

afterEach(() => {
  dispose();
  strip.remove();
  vi.useRealTimers();
});

const move = (x: number, y: number) => document.body.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: x, clientY: y }));

const mounted = () => {
  const peek = vi.fn();

  createRoot((stop) => {
    dispose = stop;
    createEdgePeek({ edge: "leading", region: () => null, sensor: () => strip, state: { peeking: () => false, peek, unpeek: () => {} } });
  });

  return peek;
};

it("u6224_a_sensor_strip_peeks_on_a_rest_and_not_on_a_fast_pass", () => {
  const peek = mounted();

  move(20, 300);
  vi.advanceTimersByTime(PEEK_DWELL - 10);
  move(300, 300);
  vi.advanceTimersByTime(PEEK_DWELL * 2);
  expect(peek).not.toHaveBeenCalled();

  move(20, 300);
  vi.advanceTimersByTime(PEEK_DWELL);
  expect(peek).toHaveBeenCalledTimes(1);

  move(20, 50);
  vi.advanceTimersByTime(PEEK_DWELL * 2);
  expect(peek).toHaveBeenCalledTimes(1);
});

it("u6228h_a_pointer_resting_on_the_handle_over_the_strip_starts_no_peek", () => {
  const handle = document.createElement("div");

  handle.className = "rail-handle";
  document.body.append(handle);
  const peek = vi.fn();

  createRoot((stop) => {
    dispose = stop;
    createEdgePeek({ edge: "leading", region: () => null, sensor: () => strip, handle: ".rail-handle", state: { peeking: () => false, peek, unpeek: () => {} } });
  });

  handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 20, clientY: 300 }));
  vi.advanceTimersByTime(PEEK_DWELL * 2);
  expect(peek).not.toHaveBeenCalled();

  move(20, 300);
  vi.advanceTimersByTime(PEEK_DWELL);
  expect(peek).toHaveBeenCalledTimes(1);
  handle.remove();
});

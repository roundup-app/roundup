import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Splitter } from "./Splitter";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("u491_keys_limits_and_reset", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800, toJSON() {} });
  const [width, setWidth] = createSignal(288);
  const preview = vi.fn();
  const commit = vi.fn(setWidth);
  render(() => <div data-layout-root=""><section data-layout-panel="rail" /><section data-layout-panel="centre" /><section data-layout-panel="shelf" hidden />
    <Splitter side={{ label: "Rail width", direction: 1, min: 252, fallback: 288, now: width, room: () => 480, preview, commit }} />
  </div>);
  const edge = screen.getByRole("separator", { name: "Rail width" });
  edge.focus();
  await vi.advanceTimersByTimeAsync(0);
  fireEvent.keyDown(edge, { key: "ArrowRight" });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(304);
  fireEvent.keyDown(edge, { key: "ArrowRight", shiftKey: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(368);
  fireEvent.keyDown(edge, { key: "End" });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(480);
  fireEvent.keyDown(edge, { key: "Home" });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(252);
  fireEvent.keyDown(edge, { key: "Enter" });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(288);
  expect(commit).toHaveBeenCalledTimes(5);
  expect(edge.getAttribute("aria-valuenow")).toBe("288");
  expect(edge.getAttribute("aria-valuemin")).toBe("252");
  expect(edge.getAttribute("aria-valuemax")).toBe("480");
  expect(edge.getAttribute("aria-orientation")).toBe("vertical");
});

import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Splitter } from "./Splitter";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([1, -1] as const)("u491_keys_limits_and_reset_direction_%s", async (direction) => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.dataset.layoutPanel === "rail" ? 288 : 1280;

    return { x: 0, y: 0, left: 0, top: 0, width, height: 800, right: width, bottom: 800, toJSON() {} };
  });
  const [width, setWidth] = createSignal(direction === 1 ? 288 : 320);
  const preview = vi.fn();
  const commit = vi.fn(setWidth);
  render(() => <div data-layout-root=""><section data-layout-panel="rail" /><section data-layout-panel="centre" /><section data-layout-panel="shelf" hidden={direction === 1} />
    <Splitter side={{ label: "Rail width", direction, min: direction === 1 ? 252 : 240, fallback: direction === 1 ? 288 : 320, now: width, room: () => direction === 1 ? 480 : 560, preview, commit }} />
  </div>);
  const edge = screen.getByRole("separator", { name: "Rail width" });
  edge.focus();
  await vi.advanceTimersByTimeAsync(0);
  fireEvent.keyDown(edge, { key: "ArrowRight" });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(304);
  fireEvent.keyDown(edge, { key: "ArrowRight", shiftKey: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(direction === 1 ? 368 : 240);
  fireEvent.keyDown(edge, { key: "End" });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(direction === 1 ? 480 : 560);
  fireEvent.keyDown(edge, { key: "Home" });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(direction === 1 ? 252 : 240);
  fireEvent.keyDown(edge, { key: "Enter" });
  await vi.advanceTimersByTimeAsync(0);
  expect(commit).toHaveBeenLastCalledWith(direction === 1 ? 288 : 320);
  expect(commit).toHaveBeenCalledTimes(5);
  expect(edge.getAttribute("aria-valuenow")).toBe(direction === 1 ? "288" : "320");
  expect(edge.getAttribute("aria-valuemin")).toBe(direction === 1 ? "252" : "240");
  expect(edge.getAttribute("aria-valuemax")).toBe(direction === 1 ? "480" : "560");
  expect(edge.getAttribute("aria-orientation")).toBe("vertical");
});


it.each(["hidden", "disabled"] as const)("u491_hidden_edge_is_not_focusable_%s", (mode) => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const [off, setOff] = createSignal(false);

  render(() => <div data-layout-root=""><section data-layout-panel="rail" /><section data-layout-panel="centre" /><section data-layout-panel="shelf" hidden />
    <Splitter hidden={mode === "hidden" && off()} disabled={mode === "disabled" && off()}
      side={{ label: "Shelf width", direction: -1, min: 240, fallback: 320, now: () => 320, room: () => 560, preview() {}, commit() {} }} />
  </div>);
  const edge = screen.getByRole("separator");

  expect(edge.tabIndex).toBe(0);
  setOff(true);
  expect(edge.tabIndex).toBe(-1);

  if (mode === "hidden") expect(edge.hidden).toBe(true);
});


it("u491_disposal_during_drag_leaves_no_callbacks_or_work", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent { readonly pointerId = 1; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800, toJSON() {} });
  const preview = vi.fn();
  const commit = vi.fn();

  const view = render(() => <div data-layout-root=""><section data-layout-panel="rail" /><section data-layout-panel="centre" /><section data-layout-panel="shelf" hidden />
    <Splitter side={{ label: "Rail width", direction: 1, min: 252, fallback: 288, now: () => 288, room: () => 480, preview, commit }} />
  </div>);

  const edge = screen.getByRole("separator");
  let captured = false;

  edge.setPointerCapture = () => { captured = true; };

  edge.hasPointerCapture = () => captured;
  edge.releasePointerCapture = () => { captured = false; };

  edge.focus();
  await vi.advanceTimersByTimeAsync(0);
  fireEvent.pointerDown(edge, { button: 0, clientX: 288, clientY: 100 });
  await vi.advanceTimersByTimeAsync(0);
  fireEvent.pointerMove(document, { buttons: 1, clientX: 352, clientY: 100 });
  await vi.advanceTimersByTimeAsync(0);
  expect(preview).toHaveBeenLastCalledWith(352);
  view.unmount();
  const count = preview.mock.calls.length;

  expect(captured).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  fireEvent.pointerMove(document, { buttons: 1, clientX: 416, clientY: 100 });
  fireEvent.pointerUp(document, { clientX: 416, clientY: 100 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(preview).toHaveBeenCalledTimes(count);
  expect(commit).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

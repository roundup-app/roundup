import { Splitter, useSplitter, type UseSplitterReturn } from "@ark-ui/solid/splitter";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";

// Zag Solid's send and resize-start/end notifications use queueMicrotask.
const settle = () => vi.advanceTimersByTimeAsync(0);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount() {
  vi.useFakeTimers();
  // jsdom lacks layout, ResizeObserver and pointer capture. Ark itself is real.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 800,
    width: 1280, height: 800, toJSON() {},
  });
  const preview = vi.fn();
  const end = vi.fn();
  let api!: UseSplitterReturn;
  const mounted = render(() => {
    api = useSplitter({
      panels: [{ id: "rail", minSize: "252px", maxSize: "480px" }, { id: "centre" }],
      defaultSize: [22.5, 77.5], onResize: preview, onResizeEnd: end,
    });
    return <Splitter.RootProvider value={api}>
      <Splitter.Panel id="rail">Rail</Splitter.Panel>
      <Splitter.ResizeTrigger id="rail:centre" aria-label="Rail width" />
      <Splitter.Panel id="centre">Centre</Splitter.Panel>
    </Splitter.RootProvider>;
  });
  const trigger = screen.getByRole("separator", { name: "Rail width" });
  let captured = false;
  trigger.setPointerCapture = () => { captured = true; };
  trigger.hasPointerCapture = () => captured;
  trigger.releasePointerCapture = () => { captured = false; };
  const down = async () => {
    fireEvent.pointerDown(trigger, { button: 0, clientX: 288, clientY: 100 });
    await settle();
  };
  const move = async (clientX: number) => {
    fireEvent.pointerMove(document, { buttons: 1, clientX, clientY: 100 });
    await settle();
  };
  return { ...mounted, api, trigger, preview, end, down, move, captured: () => captured };
}

it("u491_escape_restores_preview_without_committing_or_later_drag_events", async () => {
  const probe = mount();
  await probe.down();
  await probe.move(352);
  expect(probe.api().dragging).toBe(true);
  expect(probe.api().getPanelSize("rail")).toBeCloseTo(27.5);
  expect(probe.captured()).toBe(true);
  fireEvent.keyDown(probe.trigger, { key: "Escape" });
  await settle();
  expect(probe.api().dragging).toBe(false);
  expect(probe.api().getPanelSize("rail")).toBeCloseTo(22.5);
  expect(probe.preview).toHaveBeenLastCalledWith(expect.objectContaining({ size: [22.5, 77.5] }));
  expect(probe.captured()).toBe(false);
  expect(document.querySelector('[id$=":global-cursor"]')).toBeNull();
  const previews = probe.preview.mock.calls.length;
  fireEvent.keyDown(probe.trigger, { key: "Escape" });
  await settle();
  await probe.move(416);
  fireEvent.pointerUp(document, { clientX: 416, clientY: 100 });
  await settle();
  expect(probe.api().getPanelSize("rail")).toBeCloseTo(22.5);
  expect(probe.preview).toHaveBeenCalledTimes(previews);
  expect(probe.end).not.toHaveBeenCalled();
});

import { Splitter, useSplitter, type UseSplitterReturn } from "@ark-ui/solid/splitter";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

// Zag Solid's send and resize-start/end notifications use queueMicrotask.
const settle = () => vi.advanceTimersByTimeAsync(0);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(controlled = false) {
  vi.useFakeTimers();
  // jsdom lacks layout, ResizeObserver and pointer capture. Ark itself is real.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerId = 1;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 800,
    width: 1280, height: 800, toJSON() {},
  });
  const [size, setSize] = createSignal([22.5, 77.5]);

  const preview = vi.fn((details: { size: number[] }) => {
    if (controlled) setSize(details.size);
  });

  const start = vi.fn();
  const end = vi.fn();
  let api!: UseSplitterReturn;

  const mounted = render(() => {
    api = useSplitter({
      panels: [{ id: "rail", minSize: "252px", maxSize: "480px" }, { id: "centre" }],
      defaultSize: [22.5, 77.5],
      get size() { return controlled ? size() : undefined; },
      onResize: preview, onResizeStart: start, onResizeEnd: end,
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

  return { ...mounted, api, trigger, preview, start, end, down, move, setSize, captured: () => captured };
}

it("u491_escape_restores_preview_without_committing_or_later_drag_events", async () => {
  const probe = mount();
  // jsdom queues selectionchange on focus via setImmediate; drain it before the drag.
  probe.trigger.focus();
  await settle();
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
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

  for (const [type, listener, options] of add.mock.calls) {
    if (["pointermove", "pointerup", "pointercancel", "contextmenu"].includes(type)) {
      expect(remove).toHaveBeenCalledWith(type, listener, options);
    }
  }

  expect(vi.getTimerCount()).toBe(0);
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


it.each([false, true])("u491_a_new_drag_after_escape_commits_its_own_final_size_controlled_%s", async (controlled) => {
  const probe = mount(controlled);
  await probe.down();
  await probe.move(352);
  fireEvent.keyDown(probe.trigger, { key: "Escape" });
  await settle();
  await probe.down();
  await probe.move(416);
  fireEvent.pointerUp(probe.trigger, { clientX: 416, clientY: 100 });
  await settle();
  expect(probe.api().dragging).toBe(false);
  expect(probe.api().getPanelSize("rail")).toBeCloseTo(32.5);
  expect(probe.end).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ size: [32.5, 67.5] }));
  expect(probe.captured()).toBe(false);
});

it("u491_controlled_owner_sizes_remain_authoritative_after_escape", async () => {
  const probe = mount(true);
  probe.setSize([25, 75]);
  await settle();
  expect(probe.api().getPanelSize("rail")).toBe(25);
  await probe.down();
  await probe.move(352);
  expect(probe.api().getPanelSize("rail")).toBe(30);
  fireEvent.keyDown(probe.trigger, { key: "Escape" });
  await settle();
  expect(probe.api().getPanelSize("rail")).toBe(25);
  expect(probe.preview).toHaveBeenLastCalledWith(expect.objectContaining({ size: [25, 75] }));
  expect(probe.end).not.toHaveBeenCalled();
  probe.setSize([27.5, 72.5]);
  await settle();
  expect(probe.api().getPanelSize("rail")).toBe(27.5);
});

it.each(["queued", "started", "moved"])("u491_%s_drag_disposal_leaves_no_work_or_later_callbacks", async (stage) => {
  const probe = mount();
  // jsdom queues selectionchange on focus via setImmediate; drain it before the drag.
  probe.trigger.focus();
  await settle();
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
  fireEvent.pointerDown(probe.trigger, { button: 0, clientX: 288, clientY: 100 });

  if (stage !== "queued") await settle();

  if (stage === "moved") await probe.move(352);
  probe.unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(probe.captured()).toBe(false);
  expect(document.querySelector('[id$=":global-cursor"]')).toBeNull();

  for (const [type, listener, options] of add.mock.calls) {
    if (["pointermove", "pointerup", "pointercancel", "contextmenu"].includes(type)) {
      expect(remove).toHaveBeenCalledWith(type, listener, options);
    }
  }

  const previews = probe.preview.mock.calls.length;
  const starts = probe.start.mock.calls.length;
  await probe.move(416);
  fireEvent.pointerUp(document, { clientX: 416, clientY: 100 });
  // Includes the library's queued sends and a later frame; disposal must fence both.
  await vi.advanceTimersByTimeAsync(1000);
  expect(vi.getTimerCount()).toBe(0);
  expect(probe.preview).toHaveBeenCalledTimes(previews);
  expect(probe.start).toHaveBeenCalledTimes(starts);
  expect(probe.end).not.toHaveBeenCalled();
});


it.each([false, true])("u491_escape_without_movement_still_publishes_a_restore_preview_controlled_%s", async (controlled) => {
  const probe = mount(controlled);
  await probe.down();
  probe.preview.mockClear();
  fireEvent.keyDown(probe.trigger, { key: "Escape" });
  await settle();
  expect(probe.preview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ size: [22.5, 77.5] }));
  expect(probe.end).not.toHaveBeenCalled();
});


it("u491_disposal_fences_an_already_queued_resize_start", async () => {
  const probe = mount();
  fireEvent.pointerDown(probe.trigger, { button: 0, clientX: 288, clientY: 100 });
  // Zag send enters on a microtask, then queues onResizeStart behind this disposal.
  queueMicrotask(probe.unmount);
  await settle();
  expect(probe.start).not.toHaveBeenCalled();
  expect(probe.end).not.toHaveBeenCalled();
  expect(probe.captured()).toBe(false);
});

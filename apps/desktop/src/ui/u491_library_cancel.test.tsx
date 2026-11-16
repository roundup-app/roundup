import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { MousePointerEvent, windowRects } from "./splitterRects";
import { Splitter } from "./Splitter";

// One frame: the group lays out on a microtask and applies a pointer move on the next animation frame.
const settle = () => vi.advanceTimersByTimeAsync(16);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A width the owner keeps. With `controlled`, the owner also follows each preview, as a window that renders the dragged width does. */
function mount(controlled = false) {
  vi.useFakeTimers();
  // jsdom lacks layout, ResizeObserver, pointer events and pointer capture. The resizable group itself is real.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("PointerEvent", MousePointerEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    windowRects,
  );
  const [width, setWidth] = createSignal(288);

  const preview = vi.fn((px: number) => {
    if (controlled) setWidth(px);
  });

  const commit = vi.fn();
  const dragging = vi.fn();

  const mounted = render(() => (
    <div data-layout-root="">
      <section data-layout-panel="rail" />
      <section data-layout-panel="centre" />
      <section data-layout-panel="shelf" hidden />
      <Splitter
        onDragging={dragging}
        side={{
          label: "Rail width",
          direction: 1,
          min: 252,
          fallback: 288,
          now: width,
          room: () => 480,
          preview,
          commit,
        }}
      />
    </div>
  ));

  const edge = screen.getByRole("separator", { name: "Rail width" });
  let captured = false;

  edge.setPointerCapture = () => {
    captured = true;
  };

  edge.hasPointerCapture = () => captured;
  edge.releasePointerCapture = () => {
    captured = false;
  };

  const down = async () => {
    fireEvent.pointerDown(edge, { button: 0, clientX: 288, clientY: 100 });
    await settle();
  };

  const move = async (clientX: number) => {
    fireEvent.pointerMove(document, { buttons: 1, clientX, clientY: 100 });
    await settle();
  };

  return {
    ...mounted,
    edge,
    preview,
    commit,
    dragging,
    down,
    move,
    setWidth,
    captured: () => captured,
  };
}

const LISTENED = [
  "pointermove",
  "pointerup",
  "pointercancel",
  "contextmenu",
  "keydown",
  "blur",
];

/** Spies on the targets a drag listens on; `leaked()` is every listener of a drag event added since and not removed. */
function watchListeners() {
  const spies = [document, window].map((target) => ({
    add: vi.spyOn(target, "addEventListener"),
    remove: vi.spyOn(target, "removeEventListener"),
  }));

  return () =>
    spies.flatMap(({ add, remove }) =>
      add.mock.calls.filter(
        ([type, listener, options]) =>
          LISTENED.includes(type) &&
          !remove.mock.calls.some(
            ([removed, fn, kept]) =>
              removed === type && fn === listener && kept === options,
          ),
      ),
    );
}

it("u491_escape_restores_preview_without_committing_or_later_drag_events", async () => {
  const probe = mount();

  // jsdom queues selectionchange on focus via setImmediate; drain it before the drag.
  probe.edge.focus();
  await settle();
  const leaked = watchListeners();

  await probe.down();
  await probe.move(352);
  expect(probe.preview).toHaveBeenLastCalledWith(352);
  expect(probe.dragging).toHaveBeenLastCalledWith(true);
  expect(probe.captured()).toBe(true);
  fireEvent.keyDown(probe.edge, { key: "Escape" });
  await settle();
  expect(probe.preview).toHaveBeenLastCalledWith(288);
  expect(probe.dragging).toHaveBeenLastCalledWith(false);
  expect(probe.captured()).toBe(false);
  expect(leaked()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);

  const previews = probe.preview.mock.calls.length;

  expect(fireEvent.keyDown(probe.edge, { key: "Escape" })).toBe(true);
  await settle();
  await probe.move(416);
  fireEvent.pointerUp(document, { clientX: 416, clientY: 100 });
  await settle();
  expect(probe.preview).toHaveBeenCalledTimes(previews);
  expect(probe.commit).not.toHaveBeenCalled();
});

it.each([false, true])(
  "u491_a_new_drag_after_escape_commits_its_own_final_size_controlled_%s",
  async (controlled) => {
    const probe = mount(controlled);

    await probe.down();
    await probe.move(352);
    fireEvent.keyDown(probe.edge, { key: "Escape" });
    await settle();
    await probe.down();
    await probe.move(416);
    fireEvent.pointerUp(probe.edge, { clientX: 416, clientY: 100 });
    await settle();
    expect(probe.dragging).toHaveBeenLastCalledWith(false);
    expect(probe.commit).toHaveBeenCalledExactlyOnceWith(416);
    expect(probe.captured()).toBe(false);
  },
);

it("u491_controlled_owner_sizes_remain_authoritative_after_escape", async () => {
  const probe = mount(true);

  probe.setWidth(320);
  await settle();
  expect(probe.edge.getAttribute("aria-valuetext")).toContain("320");
  await probe.down();
  await probe.move(352);
  expect(probe.edge.getAttribute("aria-valuetext")).toContain("384");
  fireEvent.keyDown(probe.edge, { key: "Escape" });
  await settle();
  expect(probe.edge.getAttribute("aria-valuetext")).toContain("320");
  expect(probe.preview).toHaveBeenLastCalledWith(320);
  expect(probe.commit).not.toHaveBeenCalled();
  probe.setWidth(352);
  await settle();
  expect(probe.edge.getAttribute("aria-valuetext")).toContain("352");
});

it.each(["queued", "started"])(
  "u491_%s_drag_disposal_leaves_no_work_or_later_callbacks",
  async (stage) => {
    const probe = mount();

    // jsdom queues selectionchange on focus via setImmediate; drain it before the drag.
    probe.edge.focus();
    await settle();
    const leaked = watchListeners();

    fireEvent.pointerDown(probe.edge, {
      button: 0,
      clientX: 288,
      clientY: 100,
    });

    if (stage === "started") await settle();

    probe.unmount();
    expect(probe.captured()).toBe(false);
    expect(probe.dragging).toHaveBeenLastCalledWith(false);

    const previews = probe.preview.mock.calls.length;

    await probe.move(416);
    fireEvent.pointerUp(document, { clientX: 416, clientY: 100 });
    // The group's own one-shot clean-up timer and a later frame both run; disposal leaves nothing after them.
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(leaked()).toEqual([]);
    expect(probe.preview).toHaveBeenCalledTimes(previews);
    expect(probe.commit).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "u491_escape_without_movement_still_publishes_a_restore_preview_controlled_%s",
  async (controlled) => {
    const probe = mount(controlled);

    await probe.down();
    probe.preview.mockClear();
    fireEvent.keyDown(probe.edge, { key: "Escape" });
    await settle();
    expect(probe.preview).toHaveBeenCalledExactlyOnceWith(288);
    expect(probe.commit).not.toHaveBeenCalled();
  },
);

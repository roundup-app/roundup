import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { MousePointerEvent, rect, windowRects } from "./splitterRects";
import { Splitter } from "./Splitter";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// One frame: the group lays out on a microtask and applies a pointer move on the next animation frame.
const settle = () => vi.advanceTimersByTimeAsync(16);

it.each(["hidden", "disabled"] as const)(
  "u491_hidden_edge_is_not_focusable_%s",
  async (mode) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      windowRects,
    );
    const [off, setOff] = createSignal(false);

    render(() => (
      <div data-layout-root="">
        <section data-layout-panel="rail" />
        <section data-layout-panel="centre" />
        <section data-layout-panel="shelf" hidden />
        <Splitter
          hidden={mode === "hidden" && off()}
          disabled={mode === "disabled" && off()}
          side={{
            label: "Shelf width",
            direction: -1,
            min: 240,
            fallback: 320,
            now: () => 320,
            room: () => 560,
            preview() {},
            commit() {},
          }}
        />
      </div>
    ));
    const edge = screen.getByRole("separator");

    await vi.waitFor(() => expect(edge.tabIndex).toBe(0));
    setOff(true);
    await vi.waitFor(() => expect(edge.tabIndex).toBe(-1));

    if (mode === "hidden") expect(edge.hidden).toBe(true);
  },
);

it("u491_disposal_during_drag_leaves_no_callbacks_or_work", async () => {
  vi.useFakeTimers();
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
  const preview = vi.fn();
  const commit = vi.fn();
  const dragging = vi.fn();

  const view = render(() => (
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
          now: () => 288,
          room: () => 480,
          preview,
          commit,
        }}
      />
    </div>
  ));

  const edge = screen.getByRole("separator");
  let captured = false;

  edge.setPointerCapture = () => {
    captured = true;
  };

  edge.hasPointerCapture = () => captured;
  edge.releasePointerCapture = () => {
    captured = false;
  };

  await settle();
  fireEvent.pointerDown(edge, { button: 0, clientX: 288, clientY: 100 });
  await settle();
  fireEvent.pointerMove(document, { buttons: 1, clientX: 352, clientY: 100 });
  await settle();
  expect(preview).toHaveBeenLastCalledWith(352);
  view.unmount();
  const count = preview.mock.calls.length;

  expect(captured).toBe(false);
  expect(dragging).toHaveBeenLastCalledWith(false);
  expect(vi.getTimerCount()).toBe(0);
  fireEvent.pointerMove(document, { buttons: 1, clientX: 416, clientY: 100 });
  fireEvent.pointerUp(document, { clientX: 416, clientY: 100 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(preview).toHaveBeenCalledTimes(count);
  expect(commit).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

const EDGES = {
  rail: { label: "Rail width", direction: 1, min: 252, fallback: 288, room: 480 },
  shelf: { label: "Shelf width", direction: -1, min: 240, fallback: 320, room: 560 },
} as const;

/** A window with the Rail at 288 px; the Shelf's room is what the Rail leaves, up to its own limit. */
function mountEdge(name: keyof typeof EDGES) {
  const { label, room, ...limits } = EDGES[name];

  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.matches('[data-layout-panel="rail"]')
        ? rect(288)
        : windowRects.call(this);
    },
  );
  const [width, setWidth] = createSignal<number>(limits.fallback);

  const commit = vi.fn((pixels: number) => {
    setWidth(pixels);
  });

  render(() => (
    <div data-layout-root="">
      <section data-layout-panel="rail" />
      <section data-layout-panel="centre" />
      <section data-layout-panel="shelf" hidden={name === "rail"} />
      <Splitter
        side={{ label, ...limits, now: width, room: () => room, preview() {}, commit }}
      />
    </div>
  ));

  return { edge: screen.getByRole("separator", { name: label }), commit };
}

type Mounted = ReturnType<typeof mountEdge>;

// An arrow key commits when it comes up; Home, End and Enter are one action each.
async function press({ edge, commit }: Mounted, key: string, shiftKey = false) {
  commit.mockClear();
  fireEvent.keyDown(edge, { key, shiftKey });
  fireEvent.keyUp(edge, { key, shiftKey });
  await settle();
}

/** The group's own Home, End and Enter act on the panel before the handle and a double-click collapses it, so only the edge's own jump reaches the side's width. */
async function jumpsToOwnWidth(
  mounted: Mounted,
  rows: ReadonlyArray<readonly [string, number]>,
  fallback: number,
) {
  for (const [key, pixels] of rows) {
    await press(mounted, key);
    expect(mounted.commit).toHaveBeenCalledExactlyOnceWith(pixels);
    expect(mounted.edge.getAttribute("aria-valuetext")).toContain(
      String(pixels),
    );
  }

  await press(mounted, "Home");
  mounted.commit.mockClear();
  fireEvent.dblClick(mounted.edge);
  await settle();
  expect(mounted.commit).toHaveBeenCalledExactlyOnceWith(fallback);
}

it("u491_keys_limits_and_reset_commit_the_final_pixels_once", async () => {
  const mounted = mountEdge("rail");

  mounted.edge.focus();
  await settle();

  for (const [key, shiftKey, pixels] of [
    ["ArrowRight", false, 304],
    ["ArrowRight", true, 368],
  ] as const) {
    await press(mounted, key, shiftKey);
    expect(mounted.commit).toHaveBeenCalledExactlyOnceWith(pixels);
    expect(mounted.edge.getAttribute("aria-valuetext")).toContain(
      String(pixels),
    );
  }

  await jumpsToOwnWidth(
    mounted,
    [
      ["End", 480],
      ["Home", 252],
      ["Enter", 288],
    ],
    288,
  );
});

// The Shelf's handle has the rest of the window before it, so the group's own keys would resize that instead.
it("u491_shelf_home_end_and_reset_set_the_shelf_width_once", async () => {
  const mounted = mountEdge("shelf");

  mounted.edge.focus();
  await settle();
  await jumpsToOwnWidth(
    mounted,
    [
      ["End", 560],
      ["Home", 240],
      ["Enter", 320],
    ],
    320,
  );
});

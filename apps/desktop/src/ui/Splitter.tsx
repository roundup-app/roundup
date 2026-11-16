import { copy } from "./copy";
import { resizable } from "@ui-sdk/core/resizable";
import { usePart, usePrimitive } from "@ui-sdk/solid/primitive";
import { makeEventListener } from "@solid-primitives/event-listener";
import { createWritableMemo } from "@solid-primitives/memo";
import { createSignal, createUniqueId, flush, onSettled } from "solid-js";
import type { Side } from "../resize/widths";
import { withOptions } from "./primitiveOptions";
import "./Splitter.css";

const group = withOptions(resizable);

/** The group ends a drag it still holds when its handle is torn down or disabled, with no pointer event: nobody released that drag, so nothing reaches the side. */
const unreleased = (details: { reason: string; event?: unknown }) =>
  details.reason === "drag" && !details.event;

/** The width a key jumps `side` to, or undefined for a key that does not jump. */
const edgeJump = (side: Side, key: string, maximum: number): number | undefined => {
  switch (key) {
    case "Enter": return side.fallback;
    case "Home": return side.collapsedAt ?? side.min;
    case "End": return maximum;
    default: return undefined;
  }
};

/** Z3742b: an arrow moves the edge 16 px, with Shift 64 px. */
const STEP = 16;

const LARGE_STEP = 64;

/** U6228: only a jump, a double-click or a drag collapses an open side, so an arrow that would end under the minimum stops at it. */
const stopAtMinimum = (side: Side, event: KeyboardEvent, now: number): number | undefined => {
  const shrinking = side.direction === 1 ? "ArrowLeft" : "ArrowRight";

  if (side.collapsedAt === undefined || event.key !== shrinking || now <= side.collapsedAt) return undefined;

  return Math.max(side.min, now - (event.shiftKey ? LARGE_STEP : STEP));
};

/** U6228: a side that collapses reads any width under its minimum as its collapsed width. */
const boundsOf = (side: Side, maximum: number, percent: (px: number) => number) => {
  const minSize = percent(side.min);
  const maxSize = percent(maximum);
  const { collapsedAt } = side;

  return collapsedAt === undefined ? { minSize, maxSize } : { minSize, maxSize, collapsible: true, collapsedSize: percent(collapsedAt) };
};

/** Reports the layout root's width and the width of the panel the edge does not belong to, now and whenever either resizes. Returns what stops it. */
const observeLayout = (root: HTMLElement, opposite: () => "shelf" | "rail", onMeasure: (width: number, opposite: number) => void) => {
  const measure = () => {
    const panel = root.querySelector<HTMLElement>(`[data-layout-panel="${opposite()}"]`);

    onMeasure(root.getBoundingClientRect().width || 1, panel && !panel.hidden ? panel.getBoundingClientRect().width : 0);
  };

  measure();
  const observer = new ResizeObserver(measure);

  observer.observe(root);

  for (const panel of root.querySelectorAll<HTMLElement>("[data-layout-panel]")) observer.observe(panel);

  return () => observer.disconnect();
};

/** Until the press ends: `end` on release, `cancel` on a cancelled pointer, a blurred window or Escape. Returns what removes every listener. */
const listenToPress = (end: () => void, cancel: () => void) => {
  const removers = [
    makeEventListener(window, "pointerup", end, true),
    makeEventListener(window, "pointercancel", cancel, true),
    makeEventListener(window, "blur", cancel),
    makeEventListener(window, "keydown", (key) => {
      if (key.key !== "Escape") return;

      key.preventDefault();
      key.stopPropagation();
      cancel();
    }, true),
  ];

  return () => {
    for (const remove of removers) remove();
  };
};

/** Z3742b: a pixel and grid adapter over ui-sdk's resizable. The group sees two hidden panels that stand for the region and the rest of the window, with the edge between them as its handle; the group owns drags, arrow steps and bounds, in percent of the window's width. This adapter owns the pixel units, the host measurement, reset, Home and End, and cancellation. */
export function Splitter(props: {
  side: Side;
  class?: string;
  disabled?: boolean;
  hidden?: boolean;
  onDragging?: (dragging: boolean) => void;
}) {
  let edge!: HTMLDivElement;
  let endHold: (() => void) | undefined;
  const id = createUniqueId();
  const [extent, setExtent] = createSignal(1);
  const [other, setOther] = createSignal(0);
  const [pixels, setPixels] = createWritableMemo(() => props.side.now());
  const [aborting, setAborting] = createSignal(false);
  const first = () => props.side.direction === 1;

  const maximum = () =>
    Math.max(props.side.min, Math.min(props.side.room(), extent() - other()));

  const percent = (px: number) => (px / extent()) * 100;

  const pixelsOf = (layout: number[]) =>
    Math.round((layout[first() ? 0 : 1]! * extent()) / 100);

  const layout = () => {
    const side = percent(pixels());

    return first() ? [side, 100 - side] : [100 - side, side];
  };

  const primitive = usePrimitive(group, () => ({
    layout: layout(),
    step: percent(STEP),
    largeStep: percent(LARGE_STEP),
    disabled: props.disabled === true || props.hidden === true || aborting(),
    onLayoutChange: (next, details) => {
      // The group refits its bounds when the window's width changes; the owner's width already follows it.
      if (details.reason === "resize") {
        details.cancel();

        return;
      }

      if (unreleased(details)) return;
      const px = pixelsOf(next);

      setPixels(px);
      props.side.preview(px);
    },
    onLayoutCommit: (next, details) => {
      if (!unreleased(details)) props.side.commit(pixelsOf(next));
    },
  }));

  const bounds = () => boundsOf(props.side, maximum(), percent);

  const resize = (px: number) => {
    if (props.disabled || props.hidden || endHold) return;

    primitive.api.resize(`${id}-side`, percent(px));
  };

  // The group's own Home and End move the panel before the handle and Enter and a double-click collapse it; the edge's jump is the side's own width.
  const keyDown = (event: KeyboardEvent) => {
    const jump = edgeJump(props.side, event.key, maximum()) ?? stopAtMinimum(props.side, event, pixels());

    if (jump === undefined || event.altKey || event.ctrlKey || event.metaKey) return;

    event.preventDefault();
    resize(jump);
  };

  const reset = (event: MouseEvent) => {
    event.preventDefault();
    resize(props.side.fallback);
  };

  // The group ends a drag on pointercancel by committing it and has no way to abandon one: the width goes back first, so ending commits nothing, and a disabled group ends its drag.
  const abandon = (origin: number, pointerId: number) => {
    setPixels(origin);
    props.side.preview(origin);
    flush();
    setAborting(true);
    flush();
    setAborting(false);

    if (edge.hasPointerCapture?.(pointerId))
      edge.releasePointerCapture(pointerId);
  };

  // The Terminal refits once the hold ends, so the hold is the pointer's, not the group's moment-to-moment state.
  const press = (event: PointerEvent) => {
    if (event.button !== 0 || props.disabled || props.hidden) return;

    // A press takes the edge's focus, as a press on any focusable control does: Escape then reaches the edge's cancel before an App key bound to wherever focus was.
    edge.focus({ preventScroll: true });
    endHold?.();

    const origin = pixels();

    const end = () => {
      stopListening();
      endHold = undefined;
      props.onDragging?.(false);
    };

    const cancel = () => {
      abandon(origin, event.pointerId);
      end();
    };

    endHold = end;
    props.onDragging?.(true);
    const stopListening = listenToPress(end, cancel);
  };

  onSettled(() => {
    const root = edge.closest<HTMLElement>("[data-layout-root]");

    if (!root) throw new Error(copy.resizeUnavailable);

    const stopObserving = observeLayout(
      root,
      () => (first() ? "shelf" : "rail"),
      (width, opposite) => {
        setExtent(width);
        setOther(opposite);
      },
    );

    // Capture on the edge itself, so the hold is in place before the group's own press handling at the document.
    // listener-owner: onSettled refuses onCleanup, so the cleanup it returns removes this.
    edge.addEventListener("pointerdown", press, true);

    return () => {
      endHold?.();
      stopObserving();
      edge.removeEventListener("pointerdown", press, true);
    };
  });

  // The group takes the panels' combined width as the span the edge moves across, so each is half the window wide.
  const panel = (name: "side" | "rest") =>
    usePart(
      primitive,
      "panel",
      () => name === "side" ? { id: `${id}-${name}`, ...bounds() } : { id: `${id}-${name}` },
      {
        class: "app-splitter-shim",
        style: () => ({ "inline-size": `${extent() / 2}px` }),
      },
      "div",
    );

  const edgeElement = usePart(
    primitive,
    "handle",
    () => ({ id: `${id}-edge` }),
    {
      ref: (element: HTMLDivElement) => {
        edge = element;
      },
      get class() {
        return ["resize-edge", "app-splitter", props.class];
      },
      get hidden() {
        return props.hidden;
      },
      get "aria-label"() {
        return props.side.label;
      },
      get "aria-valuetext"() {
        return copy.pixelWidth(pixels());
      },
      onKeyDown: keyDown,
      onDblClick: reset,
    },
    "div",
  );

  const order = () => first() ? ["side", "rest"] as const : ["rest", "side"] as const;

  return (
    <>
      {panel(order()[0])}
      {edgeElement}
      {panel(order()[1])}
    </>
  );
}

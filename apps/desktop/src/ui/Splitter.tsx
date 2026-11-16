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
    step: percent(16),
    largeStep: percent(64),
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

  // U6228: a side that collapses reads any width under its minimum as its collapsed width.
  const bounds = () => {
    const minSize = percent(props.side.min);
    const maxSize = percent(maximum());
    const { collapsedAt } = props.side;

    return collapsedAt === undefined ? { minSize, maxSize } : { minSize, maxSize, collapsible: true, collapsedSize: percent(collapsedAt) };
  };

  const resize = (px: number) => {
    if (props.disabled || props.hidden || endHold) return;

    primitive.api.resize(`${id}-side`, percent(px));
  };

  const jumpFor = (key: string): number | undefined => {
    switch (key) {
      case "Enter": return props.side.fallback;
      case "Home": return props.side.collapsedAt ?? props.side.min;
      case "End": return maximum();
      default: return undefined;
    }
  };

  // The group's own Home and End move the panel before the handle and Enter and a double-click collapse it; the edge's jump is the side's own width.
  const keyDown = (event: KeyboardEvent) => {
    const jump = jumpFor(event.key);

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

    endHold?.();

    const origin = pixels();
    const removers: Array<() => void> = [];

    const end = () => {
      for (const remove of removers) remove();
      endHold = undefined;
      props.onDragging?.(false);
    };

    const cancel = () => {
      abandon(origin, event.pointerId);
      end();
    };

    endHold = end;
    props.onDragging?.(true);
    removers.push(
      makeEventListener(window, "pointerup", end, true),
      makeEventListener(window, "pointercancel", cancel, true),
      makeEventListener(window, "blur", cancel),
      makeEventListener(
        window,
        "keydown",
        (key) => {
          if (key.key !== "Escape") return;

          key.preventDefault();
          key.stopPropagation();
          cancel();
        },
        true,
      ),
    );
  };

  onSettled(() => {
    const root = edge.closest<HTMLElement>("[data-layout-root]");

    if (!root) throw new Error(copy.resizeUnavailable);

    const measure = () => {
      setExtent(root.getBoundingClientRect().width || 1);

      const opposite = root.querySelector<HTMLElement>(
        `[data-layout-panel="${first() ? "shelf" : "rail"}"]`,
      );

      setOther(
        opposite && !opposite.hidden
          ? opposite.getBoundingClientRect().width
          : 0,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);

    observer.observe(root);

    for (const panel of root.querySelectorAll<HTMLElement>(
      "[data-layout-panel]",
    ))
      observer.observe(panel);

    // Capture on the edge itself, so the hold is in place before the group's own press handling at the document.
    // listener-owner: onSettled refuses onCleanup, so the cleanup it returns removes this.
    edge.addEventListener("pointerdown", press, true);

    return () => {
      endHold?.();
      observer.disconnect();
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

  return (
    <>
      {panel(first() ? "side" : "rest")}
      {edgeElement}
      {panel(first() ? "rest" : "side")}
    </>
  );
}

import { makeEventListener } from "@solid-primitives/event-listener";
import { debounce } from "@solid-primitives/scheduled";
import { onCleanup } from "solid-js";
import type { ShelfFrame } from "./frame";

/** U6224: the pointer must rest this many CSS px from the window's trailing edge for this long before the Bench peeks in. */
export const PEEK_EDGE = 3;

export const PEEK_DWELL = 250;

/** U6224: a peek slides back this long after the pointer leaves the Bench, unless it returns. */
export const PEEK_GRACE = 350;

/** A Drawer, dialog, menu or drag owns the whole right side; the Terminal's scrollbar sits clear of the edge, so the sensor needs no guard for it. */
const OWNS_RIGHT_SIDE = '.drawer[data-open="true"], [role=dialog], [role=alertdialog], [role=menu], [data-dnd-dragging]';

const BENCH = ".shelf";

const BAR_TABS = ".shelf-tabs";

/** U6224: closed, peeking, open. A rested pointer at the trailing edge peeks the Bench in; use opens it for good, leaving slides it back. */
export const createShelfPeek = (frame: ShelfFrame) => {
  let grace: number | undefined;
  const dwell = debounce(frame.peek, PEEK_DWELL);
  const hold = () => { window.clearTimeout(grace); grace = undefined; };

  const release = () => { grace ??= window.setTimeout(() => { grace = undefined; frame.unpeek(); }, PEEK_GRACE); };

  const inside = (target: EventTarget | null) => target instanceof Element && target.closest(BENCH) !== null;
  // The bar tabs promote through their own click; counting their press as use would let that click close what it just opened.
  const used = (target: EventTarget | null) => target instanceof Element && inside(target) && target.closest(BAR_TABS) === null;

  const atEdge = (event: PointerEvent) => event.pointerType === "mouse" && event.buttons === 0
    && event.clientX >= document.documentElement.clientWidth - PEEK_EDGE
    && document.querySelector(OWNS_RIGHT_SIDE) === null;

  makeEventListener(document, "pointermove", (event) => {
    if (frame.peeking()) {
      if (event.buttons !== 0 && used(event.target)) frame.promote();
      else if (inside(event.target)) hold();
      else release();

      return;
    }

    if (atEdge(event)) dwell();
    else dwell.clear();
  });

  makeEventListener(document.documentElement, "pointerleave", () => {
    dwell.clear();

    if (frame.peeking()) release();
  });

  // Capture: a press in the centre closes the peek and still reaches what it hit.
  makeEventListener(document, "pointerdown", (event) => {
    if (!frame.peeking()) return;

    if (used(event.target)) frame.promote();
    else if (!inside(event.target)) frame.unpeek();
  }, { capture: true });

  const use = (event: Event) => { if (frame.peeking() && used(event.target)) frame.promote(); };

  makeEventListener(document, "keydown", use, { capture: true });
  makeEventListener(document, "focusin", use);
  makeEventListener(document, "dragenter", use);

  onCleanup(() => { dwell.clear(); hold(); });
};

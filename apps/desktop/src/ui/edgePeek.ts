import { makeEventListener } from "@solid-primitives/event-listener";
import { debounce } from "@solid-primitives/scheduled";
import { onCleanup } from "solid-js";
import { layerOpen } from "../keys/focus";

/** U6224: the pointer must rest this many CSS px from the window's edge for this long before the panel peeks in. */
export const PEEK_EDGE = 3;

export const PEEK_DWELL = 250;

/** U6224: a peek slides back this long after the pointer leaves the panel, unless it returns. */
export const PEEK_GRACE = 350;

export type EdgePeek = {
  /** Which window edge the panel slides in from. */
  edge: "leading" | "trailing";
  /** The panel that slides in; a pointer inside it holds the peek. Null while it is not mounted. */
  region: () => Element | null;
  /** A strip that also starts the dwell: a pointer whose position lies in its box counts as at the edge, whatever element takes the event. */
  sensor?: () => Element | null;
  /** A control on the panel's edge, outside the panel's element: a pointer on it holds a peek and never starts the dwell. */
  handle?: string;
  /** The panel's phase: `peek` slides it in over the centre, `unpeek` slides it back; neither saves anything. */
  state: { peeking: () => boolean; peek: () => void; unpeek: () => void };
  /** Called with the target of a press, key, focus or drag inside a peeking panel; absent, such use changes nothing. */
  promote?: (target: Element) => void;
};

/** U6224: a rested pointer at a window edge peeks a panel in; leaving slides it back; use, where the caller names one, keeps it. */
export const createEdgePeek = (peek: EdgePeek) => {
  let grace: number | undefined;
  const dwell = debounce(peek.state.peek, PEEK_DWELL);
  const hold = () => { window.clearTimeout(grace); grace = undefined; };

  const release = () => { grace ??= window.setTimeout(() => { grace = undefined; peek.state.unpeek(); }, PEEK_GRACE); };

  const onHandle = (target: EventTarget | null) => peek.handle !== undefined && target instanceof Element && target.closest(peek.handle) !== null;

  const inside = (target: EventTarget | null) => target instanceof Element && (peek.region()?.contains(target) === true || onHandle(target));

  const onSensor = (event: PointerEvent) => {
    const box = peek.sensor?.()?.getBoundingClientRect();

    return box !== undefined && event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom;
  };

  const atEdge = (event: PointerEvent) => event.pointerType === "mouse" && event.buttons === 0
    && ((peek.edge === "leading" ? event.clientX < PEEK_EDGE : event.clientX >= document.documentElement.clientWidth - PEEK_EDGE) || onSensor(event))
    && !onHandle(event.target)
    && !layerOpen(true);

  const use = (event: Event) => {
    if (peek.state.peeking() && event.target instanceof Element && inside(event.target)) peek.promote?.(event.target);
  };

  makeEventListener(document, "pointermove", (event) => {
    if (peek.state.peeking()) {
      if (event.buttons !== 0) use(event);

      if (inside(event.target)) hold();
      else release();

      return;
    }

    if (atEdge(event)) dwell();
    else dwell.clear();
  });

  makeEventListener(document.documentElement, "pointerleave", () => {
    dwell.clear();

    if (peek.state.peeking()) release();
  });

  // Capture: a press outside closes the peek and still reaches what it hit.
  makeEventListener(document, "pointerdown", (event) => {
    if (!peek.state.peeking()) return;

    if (inside(event.target)) use(event);
    else peek.state.unpeek();
  }, { capture: true });

  makeEventListener(document, "keydown", use, { capture: true });
  makeEventListener(document, "focusin", use);
  makeEventListener(document, "dragenter", use);

  onCleanup(() => { dwell.clear(); hold(); });
};

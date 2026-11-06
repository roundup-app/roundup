import GripVertical from "lucide-solid/icons/grip-vertical";
import { IconButton } from "./IconButton";
import { ReducedMotionContext } from "../app/reducedMotion";
import { clearPress } from "./pressFeedback";
import { captureFocus } from "../keys/focus";
import "./sortable.css";
import { Accessibility, AutoScroller, Cursor, Feedback, PointerActivationConstraints, PointerSensor, type DragDropManager, type Draggable, type DropAnimationFunction, type Droppable } from "@dnd-kit/dom";
import { CollisionPriority, CollisionType, type CollisionDetector, type UniqueIdentifier } from "@dnd-kit/abstract";
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers";
import { showPopover } from "@dnd-kit/dom/utilities";
import { effect } from "@dnd-kit/state";
import { DragDropProvider } from "@dnd-kit/solid";
import { isSortable } from "@dnd-kit/dom/sortable";
import { useSortable, type UseSortableInput } from "@dnd-kit/solid/sortable";
import { createContext, createEffect, createMemo, mergeProps, on, onCleanup, splitProps, useContext, type JSX } from "solid-js";

/** The reorder Token in milliseconds: how long rows slide aside and the dragged row settles. */
const reorderMs = (element: Element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--duration-reorder"));

/** A press that moves less than this is a click. */
const PRESS_DRAG_PX = 4;

// DOM 0.5.1 cancels pointercancel/Escape, but omits window blur even while activation is pending.
class InterruptiblePointerSensor extends PointerSensor {
  private stopBlur: (() => void) | undefined;

  protected override handlePointerDown(event: PointerEvent, source: Draggable, options: Parameters<PointerSensor["bind"]>[1]) {
    const previous = this.controller;

    super.handlePointerDown(event, source, options);

    if (!this.controller || this.controller === previous) return;
    const owner = event.view ?? window;
    const cancel = (event: Event) => this.handleCancel(event);

    owner.addEventListener("blur", cancel);
    this.stopBlur = () => owner.removeEventListener("blur", cancel);
  }

  protected override handleStart(source: Draggable, event: PointerEvent) {
    super.handleStart(source, event);

    // A blur during capture can make the superclass attach its final listeners after cancellation.
    if (!this.controller) this.cleanup();
  }

  protected override cleanup() {
    this.stopBlur?.();
    this.stopBlur = undefined;
    super.cleanup();
  }
}

const pointerSensor = () => ({ ...PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: PRESS_DRAG_PX })] }), plugin: InterruptiblePointerSensor });

/** Past this many pixels outside the list the preview shows no move; back inside the lower gap it follows again. */
const FAR_OUT_PX = 56;

const FAR_IN_PX = 40;

/** A drop slot changes hands only once the pointer is this share of a row nearer the other slot. */
const STICKY_ROW_SHARE = 0.25;

/** The nearest ancestor that scrolls along `axis`, else null. */
const scrollerOf = (element: Element): Element | null => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);

    if (/auto|scroll/.test(overflowX + overflowY) && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) return node;
  }

  return null;
};

/**
 * Collision against the slots the rows had at lift, never the live boxes that move.
 * A pointer drag keeps the library's target on the dragged row itself, so the library moves no row in the DOM:
 * the other rows make room by `translate`, as a function of the pointer (`pose`), and the drop takes slot `slot()`.
 * Keyboard drags keep the library's own sorting.
 * Far from the list the slot is the row's own: nothing moves and a release puts it back.
 */
const fixedSlots = (axis: "x" | "y", list: () => HTMLElement | undefined, depth: boolean) => {
  type Lift = { centres: number[]; starts: number[]; sizes: number[]; size: number; box: DOMRect; ids: Set<UniqueIdentifier>; elements: Element[]; scroller: Element | null; offset: number };

  type Row = { id: UniqueIdentifier; index: number; element: Element | undefined };

  const offset = (scroller: Element | null) => scroller ? (axis === "x" ? scroller.scrollLeft : scroller.scrollTop) : 0;
  let lift: Lift | null = null;
  let dragged: { id: UniqueIdentifier; from: number; at: number; manager: DragDropManager } | null = null;
  let slot = -1;
  let far = false;
  let pointer: { x: number; y: number } | null = null;

  const rowsOf = (): Row[] => [...dragged?.manager.registry.droppables ?? []].filter((row): row is Droppable & Row => isSortable(row)).filter(row => row.element && list()?.contains(row.element));

  const measure = (rows: readonly Row[]): Lift | null => {
    const shown = rows.filter((row): row is Row & { element: Element } => !!row.element).sort((a, b) => a.index - b.index);

    if (!shown.length) return null;
    const rects = shown.map(row => row.element.getBoundingClientRect());

    // The rows' own extent, cut to what the scrolling ancestor shows: a strip can overflow its container.
    const scroller = scrollerOf(shown[0]!.element);
    const view = scroller?.getBoundingClientRect();
    const left = Math.max(Math.min(...rects.map(r => r.left)), view?.left ?? -Infinity);
    const top = Math.max(Math.min(...rects.map(r => r.top)), view?.top ?? -Infinity);
    const right = Math.min(Math.max(...rects.map(r => r.right)), view?.right ?? Infinity);
    const bottom = Math.min(Math.max(...rects.map(r => r.bottom)), view?.bottom ?? Infinity);
    const start = axis === "x" ? "left" : "top";
    const length = axis === "x" ? "width" : "height";

    // Slots are kept in scroll-content coordinates: auto-scroll moves the rows under a fixed slot.
    return { centres: rects.map(rect => rect[start] + rect[length] / 2 + offset(scroller)), starts: rects.map(rect => rect[start] + offset(scroller)), sizes: rects.map(rect => rect[length]), size: rects[0]![length], box: new DOMRect(left, top, right - left, bottom - top), ids: new Set(shown.map(row => row.id)), elements: shown.map(row => row.element), scroller, offset: offset(scroller) };
  };

  /** Where the dragged row's start edge sits, in scroll-content coordinates, once it sits at index `to`. */
  const startOf = (from: number, to: number) => to <= from ? lift!.starts[to]! : lift!.starts[to]! + lift!.sizes[to]! - lift!.sizes[from]!;

  const shifts = (from: number, to: number): number[] | null => {
    if (!lift || from < 0 || to < 0 || to >= lift.starts.length || from >= lift.starts.length) return null;
    const order = lift.starts.map((_, index) => index).filter(index => index !== from);

    order.splice(to, 0, from);
    let cursor = lift.starts[0]!;
    const out: number[] = [];

    order.forEach((index, at) => {
      out[index] = cursor - lift!.starts[index]!;
      cursor += lift!.sizes[index]! + (lift!.starts[at + 1] === undefined ? 0 : lift!.starts[at + 1]! - lift!.starts[at]! - lift!.sizes[at]!);
    });

    return out;
  };

  // The pointer picks the slot nearest the dragged row; it changes hands only past STICKY_ROW_SHARE of a row.
  const update = () => {
    if (!dragged || !pointer) return;
    const rows = rowsOf();

    // A row that joined the list mid-drag makes new slots. One that leaves keeps its slot, and a row unregistered for a moment changes nothing.
    if (!lift || rows.some(row => !lift!.ids.has(row.id))) {
      lift = measure(rows);

      if (!lift) return;
    }

    const { x, y } = pointer;
    const { box } = lift;
    // A tree takes its depth from how far the pointer sits beyond the list's end edge, so that overrun is no distance from the list.
    const gap = Math.hypot(Math.max(box.left - x, 0, depth && axis === "y" ? 0 : x - box.right), Math.max(box.top - y, 0, depth && axis === "x" ? 0 : y - box.bottom));

    far = far ? gap > FAR_IN_PX : gap > FAR_OUT_PX;

    if (far) { slot = dragged.from;

 return; }

    const along = (axis === "x" ? x : y) + offset(lift.scroller);
    const distance = (index: number) => Math.abs((lift?.centres[index] ?? Infinity) - along);
    const nearest = lift.centres.reduce((best, _, index) => distance(index) < distance(best) ? index : best, 0);

    if (nearest !== slot && distance(slot) - distance(nearest) > STICKY_ROW_SHARE * lift.size) slot = nearest;
  };

  /**
   * How far each row at lift shows from its place now: the dragged row's centre, moved by the pointer, sits between two slots,
   * and every other row stands that share of the way between its places for those two slots (the paper's `d.between`).
   */
  const pose = (): number[] | null => {
    if (!lift || !dragged || !pointer) return null;
    const { from } = dragged;

    if (far) return lift.starts.map(() => 0);
    const centre = startOf(from, from) + lift.sizes[from]! / 2 + (axis === "x" ? pointer.x : pointer.y) - dragged.at + offset(lift.scroller) - lift.offset;
    const slots = lift.starts.map((_, to) => startOf(from, to) + lift!.sizes[from]! / 2);
    const k = Math.max(0, Math.min(slots.length - 2, slots.findLastIndex(at => at <= centre)));
    const share = slots.length < 2 ? 0 : Math.max(0, Math.min(1, (centre - slots[k]!) / (slots[k + 1]! - slots[k]!)));
    const a = shifts(from, k), b = shifts(from, Math.min(k + 1, slots.length - 1));

    return a && b ? a.map((shift, index) => index === from ? 0 : shift + (b[index]! - shift) * share) : null;
  };

  type Input = { droppable: Droppable; dragOperation: { source: Draggable | null; target: Droppable | null; activatorEvent: Event | null } };

  const choose = ({ droppable, dragOperation }: Input) => {
    const { source, target } = dragOperation;

    if (!isSortable(droppable) || !isSortable(source)) return null;
    const hit = { id: droppable.id, value: 1, type: CollisionType.Collision, priority: CollisionPriority.Normal };

    // Keyboard drags choose their own target; a pointer drag's target stays the row itself.
    return (dragOperation.activatorEvent instanceof KeyboardEvent ? target?.id : source.id) === droppable.id ? hit : null;
  };

  // SAFETY: the library calls this with the DOM package's draggables and droppables, which is the `Input` it reads; its generic parameters only widen them.
  const detect = choose as CollisionDetector;

  let posed: ((pose: number[]) => void) | undefined;

  const at = (x: number, y: number) => {
    pointer = { x, y };
    update();
    const now = pose();

    if (now) posed?.(now);
  };

  const scrolled = () => { update(); const now = pose();

 if (now) posed?.(now); };

  const follow = (event: PointerEvent) => at(event.clientX, event.clientY);
  const moved = (x: number, y: number) => { if (dragged) at(x, y); };

  return {
    detect,
    /** The drag's own report of the pointer: the move that started the drag reaches no listener of ours. */
    moved,
    isFar: () => far,
    /** The slot a pointer release takes now. */
    slot: () => slot,
    /** Where the dragged row's start edge shows once it sits at index `to`: the rows' places at lift, in view coordinates now. */
    startAt: (from: number, to: number): number | null => {
      if (!lift || from < 0 || to < 0 || to >= lift.starts.length || from >= lift.starts.length) return null;

      return startOf(from, to) - offset(lift.scroller);
    },
    /** How far each row shows from its place at lift once the row at `from` sits at `to`; the dragged row's own entry is its move. */
    shifts,
    /** The rows in their order at lift. */
    rowsAtLift: (): readonly Element[] => lift?.elements ?? [],
    /** Starts reading the pointer for one drag of `source`, grabbed at `grab`; `onPose` gets every row's offset as the pointer moves. Returns what stops it. */
    begin: (source: Draggable | null, grab: { x: number; y: number }, current: { x: number; y: number }, onPose: (pose: number[]) => void) => {
      lift = null; far = false; pointer = null; dragged = null; slot = -1; posed = onPose;

      if (!isSortable(source) || !source.manager) return () => undefined;
      dragged = { id: source.id, from: source.initialIndex, at: axis === "x" ? grab.x : grab.y, manager: source.manager };
      slot = source.initialIndex;
      lift = measure(rowsOf());
      // The move that started the drag was made before this listener: the slot starts from where the pointer is now, not from the lift.
      pointer = { x: current.x, y: current.y };
      update();
      window.addEventListener("pointermove", follow, { capture: true });
      window.addEventListener("scroll", scrolled, { capture: true, passive: true });

      return () => {
        window.removeEventListener("pointermove", follow, { capture: true });
        window.removeEventListener("scroll", scrolled, { capture: true });
        posed = undefined;
      };
    },
  };
};

const easingOut = (element: Element = document.documentElement) => getComputedStyle(element).getPropertyValue("--easing-out").trim();

const translateOf = (element: Element) => {
  const [x = "0", y = "0"] = getComputedStyle(element).translate.split(" ");

  return { x: Number.parseFloat(x) || 0, y: Number.parseFloat(y) || 0 };
};

/** Moves the floating row so its box starts at `to`; resolves once it has arrived. */
const glide = (element: HTMLElement, to: { x: number; y: number }, duration: number, easing: string) => {
  const rect = element.getBoundingClientRect();
  const from = translateOf(element);
  const target = `${from.x + to.x - rect.x}px ${from.y + to.y - rect.y}px`;

  // Reduced motion lands at once.
  if (!duration) {
    element.style.translate = target;

    return Promise.resolve();
  }

  const animation = element.animate({ translate: [`${from.x}px ${from.y}px`, target] }, { duration, easing, fill: "forwards" });

  return new Promise<void>(resolve => { animation.onfinish = () => resolve(); animation.oncancel = () => resolve(); });
};

/** Longest the dragged row waits at its new place for the Daemon's answer to show in the list. */
const ANSWER_WAIT_MS = 2500;

const SlotsContext = createContext<CollisionDetector>();

/** A drop target outside the list; `element` carries `data-drop` while the pointer is over it. */
type ExternalTarget = { element: HTMLElement; /** Carried instead of the list's `attribute` while the pointer is over this target. */ attribute?: string };

type External<T extends ExternalTarget> = {
  /** The target under the pointer for a dragged row, else null. */
  target: (id: string, x: number, y: number) => T | null;
  onDropOutside: (id: string, target: T) => void;
  /** The attribute the target carries while the pointer is over it; default `data-drop`. */
  attribute?: string;
};

/** What a move gives back: a promise of the Daemon's refusal text, or nothing to wait for. */
type MoveAnswer = Promise<string | null | void> | void;

/** A row of the caller's tree, in display order. */
export type TreeRow = { id: string; parent: string | null };

/** Where a drag would land: the parent, the index among that parent's other children, and the depth the drop line sits at. */
type SortableDrop = { parent: string | null; index: number; depth: number };

/** A committed drop: `index` counts the parent's children without the dragged row. */
export type SortableMove = { id: string; parent: string | null; index: number };

/** Rows with a parent: a drop reports `onMove` instead of the flat order. */
type SortableTree = {
  rows: readonly TreeRow[];
  /** One level of indentation in pixels: how far right of where the drag began picks the next deeper parent. */
  indent: number;
  /** The row content's inset from its border box, in pixels, at its current depth. */
  inset: (element: HTMLElement) => number;
  nests: (id: string) => boolean;
  /** A string the promise resolves to is the Daemon's refusal; the dragged row then blends back once. */
  onMove: (move: SortableMove) => MoveAnswer;
  /** The drop a release would commit, or null once the drag ends. */
  onPreview: (drop: SortableDrop | null) => void;
};

type RootProps<T extends ExternalTarget> = Omit<JSX.HTMLAttributes<HTMLDivElement>, "onDrag"> & {
  ids: readonly string[];
  /** The flat order after a drop; not called when `tree` is given. */
  onOrderChange?: ((ids: string[], moved: string) => MoveAnswer) | undefined;
  tree?: SortableTree | undefined;
  external?: External<T> | undefined;
  /** The handles are buttons that keep their own meaning: the library adds no live region and no `aria-pressed`, `aria-grabbed`, `aria-disabled`, role description or description to them. */
  plain?: boolean;
  /** The rows run left to right: the landing slot takes the dragged row's width as well as its height, shows as a gap with no outline, and the list does not auto-scroll under the pointer (U6220c). */
  horizontal?: boolean;
  /** The list element, for a caller that also measures or scrolls it. */
  ref?: ((element: HTMLDivElement) => void) | undefined;
  /** Called with true when a drag of one of this list's rows starts and false when it ends. */
  onDrag?: ((active: boolean) => void) | undefined;
};

type DepthRow = TreeRow & { depth: number };

const withDepth = (rows: readonly TreeRow[]): DepthRow[] => {
  const depths = new Map<string, number>();

  return rows.map((row) => {
    const depth = row.parent === null ? 0 : (depths.get(row.parent) ?? -1) + 1;

    depths.set(row.id, depth);

    return { ...row, depth };
  });
};

/** The rows without the dragged row and the rows that move with it, which are not drop targets. */
const remainingRows = (rows: readonly DepthRow[], dragged: string): DepthRow[] => {
  const moving = new Set([dragged]);

  for (const row of rows) if (row.parent !== null && moving.has(row.parent)) moving.add(row.id);

  return rows.filter((row) => !moving.has(row.id));
};

type DepthRange = { min: number; max: number };

/** The depths a drop in gap `slot` (0 is above the first row) of `rows` can have. */
const depthsAt = (rows: readonly DepthRow[], nests: (id: string) => boolean, slot: number): DepthRange => {
  const above = rows[slot - 1];
  const below = rows[slot];

  if (!above) return { min: 0, max: 0 };

  // A row shown with children takes a drop between them only as a child.
  if (below && below.depth > above.depth) return { min: above.depth + 1, max: above.depth + 1 };

  return { min: below?.depth ?? 0, max: above.depth + (nests(above.id) ? 1 : 0) };
};

/** The drop for gap `slot` of `rows` with the pointer at `depth`, clamped to the depths the gap allows. `rows` holds neither the dragged row nor what moves with it. */
const dropAt = (rows: readonly DepthRow[], nests: (id: string) => boolean, slot: number, depth: number): SortableDrop => {
  const above = rows[slot - 1];

  if (!above) return { parent: null, index: 0, depth: 0 };

  const { min, max } = depthsAt(rows, nests, slot);
  const wanted = Math.min(Math.max(depth, min), max);

  if (wanted > above.depth) return { parent: above.id, index: 0, depth: wanted };

  const anchor = rows.slice(0, slot).findLast((row) => row.depth === wanted);

  if (!anchor) throw new Error(`no row at depth ${wanted} above gap ${slot}`);

  const siblings = rows.filter((row) => row.parent === anchor.parent);

  return { parent: anchor.parent, index: siblings.findIndex((row) => row.id === anchor.id) + 1, depth: wanted };
};

/** Releasing the row where it already sits changes nothing. */
const isInPlace = (rows: readonly DepthRow[], dragged: string, drop: SortableDrop): boolean => {
  const row = rows.find((each) => each.id === dragged);

  if (!row) throw new Error(`no row ${dragged}`);

  return row.parent === drop.parent && rows.filter((each) => each.parent === row.parent).findIndex((each) => each.id === dragged) === drop.index;
};

/** The click the browser sends after a pointer release would reach whatever lies under the pointer; this drops the next one. */
const swallowNextClick = (): (() => void) => {
  const swallow = (click: Event) => click.stopPropagation();
  const forget = () => window.removeEventListener("click", swallow, { capture: true });

  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(forget);

  return forget;
};

const Root = <T extends ExternalTarget>(props: RootProps<T>) => {
  const reduced = useContext(ReducedMotionContext) ?? (() => matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [local, rest] = splitProps(props, ["ids", "onOrderChange", "tree", "external", "plain", "horizontal", "ref", "onDrag", "children"]);
  let over: T | null = null;
  let list: HTMLDivElement | undefined;
  let stopTracking: (() => void) | undefined;
  let stopPointer: (() => void) | undefined;
  const slots = fixedSlots(local.horizontal ? "x" : "y", () => list, !!local.tree);

  // A drop shows its new order at once: the dragged row settles into the slot and waits there until the list itself shows the order, or the Daemon refuses.
  // The move itself runs once the row has landed (`run`): a list that redraws on a move then blocks no frame of the settle.
  let commit: { start: number | null; run: () => MoveAnswer; key: string; undo: () => void; clear: () => void } | null = null;

  /** Keeps `next` as the drop to commit; if no drop animation takes it within a second, it commits without one. */
  const hold = (next: NonNullable<typeof commit>) => {
    commit = next;
    setTimeout(() => { if (commit === next) { commit = null; next.run(); next.clear(); } }, 1000);
  };

  const shownOrder = createMemo(() => local.tree ? local.tree.rows.map(row => `${row.id}>${row.parent}`).join() : local.ids.join());
  const arrivals = new Set<() => void>();

  // The rows' offsets go in the same update that redraws the list: a list that slides its rows reads where they show before it redraws and again after.
  // The list moves the dropped row's node when it shows the move, which drops focus; the handle takes it back.
  let refocus: HTMLElement | null = null;

  createEffect(on(shownOrder, () => {
    for (const arrive of arrivals) arrive();

    if (refocus?.isConnected && document.activeElement === document.body) refocus.focus();
    refocus = null;
  }, { defer: true }));

  const along = (shift: number) => `${local.horizontal ? shift : 0}px ${local.horizontal ? 0 : shift}px`;
  const slides = new WeakMap<Element, Animation>();

  /** Shows each row `shift` px from its place: at once, or sliding from where it shows now. Reads every row before it writes one. */
  const place = (rows: readonly { element: HTMLElement; shift: number }[], slide: boolean) => {
    const from = slide ? rows.map(({ element }) => { const now = translateOf(element);

 return local.horizontal ? now.x : now.y; }) : [];

    const easing = slide ? easingOut() : "";
    const duration = slide ? reorderMs(document.documentElement) : 0;

    rows.forEach(({ element, shift }, at) => {
      slides.get(element)?.cancel();
      element.style.translate = shift ? along(shift) : "";

      if (slide && Math.abs(from[at]! - shift) >= 0.5 && !reduced()) slides.set(element, element.animate({ translate: [along(from[at]!), along(shift)] }, { duration, easing }));
    });
  };

  // A row shown off its place is cut off by any box between it and the list that clips (the collapsible group of a tree), so those boxes show their overflow until the drop is done.
  // A collapsed group's rows are inert and stay hidden. A drop that ends reclips only the boxes its own drag unclipped: a later drag may hold them already.
  let unclipped: readonly { box: HTMLElement; overflow: string }[] = [];

  const reclip = (these = unclipped) => {
    if (these !== unclipped) return;

    for (const { box, overflow } of these) box.style.overflow = overflow;
    unclipped = [];
  };

  const reclipAfterSlide = (these = unclipped) => setTimeout(() => reclip(these), reduced() ? 0 : reorderMs(document.documentElement));

  const unclip = (rows: readonly Element[]) => {
    reclip();
    const clips = (value: string) => value === "hidden" || value === "clip";
    const boxes = new Set<HTMLElement>();

    for (const row of rows) {
      if (row.closest("[inert]")) continue;

      for (let box = row.parentElement; box && box !== list; box = box.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(box);

        if ((clips(overflowX) || clips(overflowY)) && ![overflowX, overflowY].some(value => value === "auto" || value === "scroll")) boxes.add(box);
      }
    }

    unclipped = [...boxes].map(box => ({ box, overflow: box.style.overflow }));

    for (const box of boxes) box.style.overflow = "visible";
  };

  /** The other rows of a pointer drag, in their order at lift, with the dragged row left out. */
  const others = (source: Draggable | null) => isSortable(source) ? slots.rowsAtLift().flatMap((element, index) => index !== source.initialIndex && element instanceof HTMLElement ? [{ element, index }] : []) : [];

  // A pointer drag moves no row in the DOM; the list changes only when the Daemon answers. Until then the siblings slide to the places the drop gives them, and stay.
  const showDrop = (source: Draggable | null, to: number, slide: boolean) => {
    const shifts = isSortable(source) ? slots.shifts(source.initialIndex, to) : null;
    const dragged = shifts ? others(source) : [];

    const these = unclipped;

    place(dragged.map(({ element, index }) => ({ element, shift: shifts![index] ?? 0 })), slide);

    return {
      undo: () => { place(dragged.map(({ element }) => ({ element, shift: 0 })), true); reclipAfterSlide(these); },
      clear: () => { place(dragged.map(({ element }) => ({ element, shift: 0 })), false); reclip(these); },
    };
  };

  /** Shows `element` offset by `by` from its place, sliding there from where it shows now when `slide`. */
  const offsetTo = (element: HTMLElement, by: { x: number; y: number }, slide: boolean) => {
    const from = translateOf(element);
    const to = by.x || by.y ? `${by.x}px ${by.y}px` : "";

    slides.get(element)?.cancel();
    element.style.translate = to;

    if (slide && Math.hypot(from.x - by.x, from.y - by.y) >= 0.5 && !reduced()) slides.set(element, element.animate({ translate: [`${from.x}px ${from.y}px`, `${by.x}px ${by.y}px`] }, { duration: reorderMs(document.documentElement), easing: easingOut() }));
  };

  /**
   * Runs the move once the library has let go of the dropped row, so the list is the only writer of its DOM when it redraws.
   * Until the list shows the move, the dropped row stays where it landed (`landed`, from its place in the list) and the others where the drop put them.
   */
  const commitDrop = (dragged: NonNullable<typeof commit>, row: HTMLElement, landed: { x: number; y: number }) => {
    const answer = dragged.run();
    let open = true;

    // The list showing the order puts every row where it waited; a refusal or a silent Daemon sends them back to their own places.
    const end = (shown: boolean) => {
      if (!open) return;
      open = false;
      arrivals.delete(arrived);

      if (shown) { dragged.clear(); offsetTo(row, { x: 0, y: 0 }, false);

 return; }

      dragged.undo();
      offsetTo(row, { x: 0, y: 0 }, Math.hypot(landed.x, landed.y) > 1);
    };

    const arrived = () => end(true);

    // A list that draws the move at once (the Rail) already shows the new order: holding the rows too would shift them twice.
    if (shownOrder() !== dragged.key) return end(true);
    arrivals.add(arrived);

    if (answer instanceof Promise) answer.then(reply => { if (reply) end(false); }, () => end(false));
    setTimeout(() => end(false), ANSWER_WAIT_MS);
  };

  const settle: DropAnimationFunction = async ({ source, feedbackElement, element, placeholder }) => {
    const dragged = commit;
    const duration = reduced() ? 0 : reorderMs(document.documentElement);
    const easing = easingOut();
    const home = () => (placeholder?.isConnected ? placeholder : element).getBoundingClientRect();

    const landing = () => {
      const box = home();

      if (dragged?.start == null) return { x: box.x, y: box.y };

      return local.horizontal ? { x: dragged.start, y: box.y } : { x: box.x, y: dragged.start };
    };

    commit = null;

    // A list that remounts the row on a drop leaves nothing to settle.
    if (!(feedbackElement instanceof HTMLElement) || !feedbackElement.isConnected) { dragged?.run(); dragged?.clear();

 return; }

    const floating = feedbackElement;

    // Moving the row in the DOM takes it out of the top layer; the library shows it again for its own drop animation.
    showPopover(floating);

    // The library pins the dragged row's `translate` while dragging; marking it dropping frees the property for the glide, which starts where the row shows.
    const resting = translateOf(floating);

    floating.setAttribute("data-dnd-dropping", "");
    floating.style.translate = `${resting.x}px ${resting.y}px`;
    await glide(floating, landing(), duration, easing);

    // The library clears the dropping mark only after its own drop animation; one left on the row frees its `translate` on every later drag, and the row stops following the pointer.
    if (!dragged) {
      for (const animation of floating.getAnimations()) animation.cancel();
      floating.removeAttribute("data-dnd-dropping");
      floating.style.translate = "";

      return;
    }

    // Once this resolves the library resets the row's styles and puts it back in the list at its placeholder, which a pointer drag never moved.
    // When it marks the row idle, the row takes an offset from there that keeps it where it landed, and the move runs.
    // The library copies the row's `translate` onto its placeholder; the row's place is the placeholder's box without it.
    const now = floating.getBoundingClientRect(), spot = home(), copied = translateOf(placeholder?.isConnected ? placeholder : element);
    const landed = { x: now.x - spot.x + copied.x, y: now.y - spot.y + copied.y };
    let stop: (() => void) | undefined = undefined;

    stop = effect(() => {
      if (source.status !== "idle") return;
      stop?.();

      for (const animation of floating.getAnimations()) animation.cancel();
      floating.removeAttribute("data-dnd-dropping");
      offsetTo(floating, landed, false);
      setTimeout(() => commitDrop(dragged, floating, landed));
    });
  };

  // Keyboard drags choose depth with ArrowLeft and ArrowRight; `slot` is the gap `depth` belongs to.
  let keyboard: { slot: number; depth: number } | null = null;
  let previewed: SortableDrop | null = null;
  let ownDepth = 0;

  let stopListening: (() => void) | undefined;

  // The dragged row follows the pointer; its gap in the list shifts right of where it began by the depth the drop would have.
  const preview = (drop: SortableDrop | null) => {
    if (drop?.parent === previewed?.parent && drop?.index === previewed?.index && drop?.depth === previewed?.depth) return;

    previewed = drop;

    if (local.tree) list?.style.setProperty("--sortable-shift", `${((drop?.depth ?? ownDepth) - ownDepth) * local.tree.indent}px`);
    local.tree?.onPreview(drop);
  };

  /** The drop the drag would commit now, from the library's index for the dragged row and the pointer's offset. */
  const resolve = (tree: SortableTree, dragged: string, index: number, pointer: { initial: number; current: number }) => {
    const rows = withDepth(tree.rows);
    const remaining = remainingRows(rows, dragged);
    const remainingIds = new Set(remaining.map((row) => row.id));
    const slot = rows.filter((row) => row.id !== dragged).slice(0, index).filter((row) => remainingIds.has(row.id)).length;
    const own = rows.find((row) => row.id === dragged);

    if (!own) throw new Error(`no row ${dragged}`);

    if (keyboard && keyboard.slot !== slot) keyboard = { slot, depth: depthsAt(remaining, tree.nests, slot).min };

    const depth = keyboard ? keyboard.depth : own.depth + Math.round((pointer.current - pointer.initial) / tree.indent);

    return { rows, drop: dropAt(remaining, tree.nests, slot, depth) };
  };

  /** The index a drop gives the dragged row: the library's for a keyboard drag, the slot under the pointer otherwise. */
  const indexOf = (source: Draggable & { index: number }) => source.manager?.dragOperation.activatorEvent instanceof KeyboardEvent ? source.index : slots.slot();

  const track = (source: Draggable | null, position: { initial: { x: number }; current: { x: number; y: number } }) => {
    const tree = local.tree;

    if (!tree || !isSortable(source)) return;
    const atLift = !keyboard && source.manager?.dragOperation.shape?.initial.containsPoint({ x: position.initial.x, y: position.current.y });
    preview(resolve(tree, String(source.id), atLift ? source.initialIndex : indexOf(source), { initial: position.initial.x, current: position.current.x }).drop);
  };

  const mark = (next: T | null) => {
    const attributeOf = (target: T | null) => target?.attribute ?? local.external?.attribute ?? "data-drop";

    if (next?.element !== over?.element) {
      if (over) over.element.removeAttribute(attributeOf(over));

      if (next) next.element.setAttribute(attributeOf(next), "");
    }

    over = next;
  };

  let stopRestoringFocus: (() => void) | undefined;

  // `@dnd-kit/solid` puts the dragged row back next to the elements it had at lift, but the library's placeholder now follows it,
  // so it lands past the text node the list keeps after each row, and the list's next redraw then moves the wrong rows. Put it back exactly.
  let lifted: { element: Element; parent: ParentNode; before: ChildNode | null } | null = null;

  const unmoveLifted = () => {
    if (!lifted || lifted.element.parentNode !== lifted.parent || lifted.element.previousSibling === lifted.before) return;

    if (lifted.before && lifted.before.parentNode !== lifted.parent) return;

    if (lifted.before) lifted.before.after(lifted.element);
    else lifted.parent.prepend(lifted.element);
  };

  const clearPreview = () => {
    stopTracking?.();
    stopTracking = undefined;
    list?.removeAttribute("data-sortable-index");
    list?.style.removeProperty("--sortable-shift");
  };

  onCleanup(() => { clearPreview(); stopPointer?.(); stopRestoringFocus?.(); stopListening?.(); mark(null); reclip(); });

  return <SlotsContext.Provider value={slots.detect}><DragDropProvider sensors={defaults => defaults.map(sensor => sensor === PointerSensor ? pointerSensor() : sensor)} modifiers={local.horizontal ? [RestrictToHorizontalAxis] : []} onDragStart={(event) => {
    const tree = local.tree;
    const source = event.operation.source;
    const feedback = source?.manager?.registry.plugins.get(Feedback);

    if (feedback) feedback.dropAnimation = undefined;

    if (source?.element) {
      clearPress(source.element);

      for (const control of source.element.querySelectorAll("[data-pressed]")) clearPress(control);
    }

    previewed = null;
    refocus = null;
    clearPreview();
    stopPointer?.();
    lifted = source?.element?.parentNode ? { element: source.element, parent: source.element.parentNode, before: source.element.previousSibling } : null;
    let wasFar = false;

    // The other rows follow the pointer; they slide only when the far zone flips.
    stopPointer = slots.begin(source, event.operation.position.initial, event.operation.position.current, pose => {
      const far = slots.isFar();

      place(others(source).map(({ element, index }) => ({ element, shift: pose[index] ?? 0 })), far !== wasFar);
      wasFar = far;
      list?.setAttribute("data-sortable-index", String(slots.slot()));
    });

    if (!(event.operation.activatorEvent instanceof KeyboardEvent)) unclip(slots.rowsAtLift());

    if (source?.element instanceof HTMLElement) {
      const keyboardLift = event.operation.activatorEvent instanceof KeyboardEvent;
      const duration = keyboardLift || reduced() ? 0 : reorderMs(source.element);
      const easing = easingOut(source.element);

      // The other rows make room by sortable transitions; the dragged row follows the pointer with none.
      for (const draggable of source.manager?.registry.draggables ?? []) {
        if (isSortable(draggable)) draggable.sortable.transition = { duration: draggable === source ? 0 : duration, easing };
      }

      ownDepth = tree ? withDepth(tree.rows).find(row => row.id === String(source.id))?.depth ?? 0 : 0;

      stopTracking = effect(() => {
        if (!isSortable(source)) return;
        const index = indexOf(source);

        // A pointer drag moves no row in the library: the slot the pointer takes is the index.
        list?.setAttribute("data-sortable-index", String(event.operation.activatorEvent instanceof KeyboardEvent ? index : slots.slot()));

        track(source, event.operation.position);
      });
    }

    stopListening?.();
    local.onDrag?.(true);

    if (!tree || !isSortable(source) || !(event.operation.activatorEvent instanceof KeyboardEvent)) {
      keyboard = null;

      return;
    }

    const rows = withDepth(tree.rows);
    const dragged = String(source.id);
    const remaining = remainingRows(rows, dragged);
    const own = rows.find((row) => row.id === dragged);

    if (!own) throw new Error(`no row ${dragged}`);
    keyboard = { slot: rows.slice(0, rows.indexOf(own)).filter((row) => remaining.includes(row)).length, depth: own.depth };

    const turn = (key: KeyboardEvent) => {
      if (!keyboard || (key.key !== "ArrowLeft" && key.key !== "ArrowRight")) return;
      key.preventDefault();
      key.stopPropagation();

      const { min, max } = depthsAt(remaining, tree.nests, keyboard.slot);

      keyboard = { slot: keyboard.slot, depth: Math.min(Math.max(keyboard.depth + (key.key === "ArrowRight" ? 1 : -1), min), max) };
      preview(dropAt(remaining, tree.nests, keyboard.slot, keyboard.depth));
    };

    window.addEventListener("keydown", turn, { capture: true });
    stopListening = () => window.removeEventListener("keydown", turn, { capture: true });
  }} plugins={(defaults) => defaults.filter((plugin) => plugin !== Cursor && !(local.plain && plugin === Accessibility) && !(local.horizontal && plugin === AutoScroller)).map((plugin) => plugin === Feedback ? Feedback.configure({ dropAnimation: settle, keyboardTransition: null }) : plugin)} onDragMove={(event) => {
    const { source, position } = event.operation;

    // The library dispatches dragmove before it applies the move, so the destination is `to`, else the current position plus `by`.
    const x = event.to?.x ?? position.current.x + (event.by?.x ?? 0);
    const y = event.to?.y ?? position.current.y + (event.by?.y ?? 0);

    if (!(event.operation.activatorEvent instanceof KeyboardEvent)) slots.moved(x, y);
    track(source, { initial: position.initial, current: { x, y } });

    if (!local.external || !source) return;
    mark(local.external.target(String(source.id), x, y));
  }} onDragEnd={(event) => {
    const source = event.operation.source;
    const outside = over;
    const pointerDrag = !(event.operation.activatorEvent instanceof KeyboardEvent);
    const far = pointerDrag && slots.isFar();

    unmoveLifted();
    lifted = null;

    clearPreview();
    stopPointer?.();
    stopPointer = undefined;

    mark(null);
    local.onDrag?.(false);
    stopListening?.();
    stopListening = undefined;

    const focus = captureFocus();
    const handle = source?.handle;

    if (source && handle instanceof HTMLElement) {
      stopRestoringFocus?.();
      stopRestoringFocus = effect(() => {
        if (source.status !== "idle") return;
        // Idle precedes the library replacing its placeholder; focus after that replacement.
        queueMicrotask(() => {
          stopRestoringFocus?.();

          focus(() => { if (handle.isConnected) handle.focus(); });
          refocus = handle;
        });
      });
    }

    const tree = local.tree;
    const point = event.operation.position.current;

    // The preview shows what a release commits: far from the list it shows no move, and nothing commits.
    const index = isSortable(source) ? pointerDrag && event.operation.shape?.initial.containsPoint(tree ? { x: event.operation.position.initial.x, y: point.y } : point) ? source.initialIndex : pointerDrag ? slots.slot() : source.index : null;

    // A pointer release that commits nothing sends the other rows back.
    const relax = () => { if (pointerDrag) { place(others(source).map(({ element }) => ({ element, shift: 0 })), true); reclipAfterSlide(); } };

    const final = tree && !far && !event.canceled && isSortable(source)
      ? resolve(tree, String(source.id), index ?? source.index, { initial: event.operation.position.initial.x, current: event.operation.position.current.x })
      : null;

    keyboard = null;
    previewed = null;
    tree?.onPreview(null);

    if (pointerDrag) swallowNextClick();

    // The row ends over another list: the list's glide (U3311) is its one motion, so the library's drop animation stays off.
    if (outside && source && local.external) {
      const feedback = source.manager?.registry.plugins.get(Feedback);

      if (feedback) feedback.dropAnimation = null;
    }

    if (event.canceled) { relax();

 return; }

    if (outside && source && local.external) {
      relax();
      local.external.onDropOutside(String(source.id), outside);

      return;
    }

    if (tree) {
      if (final && !isInPlace(final.rows, String(source?.id), final.drop)) {
        const run = () => tree.onMove({ id: String(source?.id), parent: final.drop.parent, index: final.drop.index });

        if (isSortable(source)) hold({ start: slots.startAt(source.initialIndex, index ?? source.index), run, key: shownOrder(), ...showDrop(source, index ?? source.index, pointerDrag) });
        else run();
      } else relax();

      return;
    }

    if (far || !isSortable(source) || source.initialIndex === index) { relax();

 return; }

    const order = [...local.ids];
    const [moved] = order.splice(source.initialIndex, 1);

    if (moved === undefined) { relax();

 return; }

    order.splice(index ?? source.initialIndex, 0, moved);
    const run = () => local.onOrderChange?.(order, String(source.id));

    hold({ start: slots.startAt(source.initialIndex, index ?? source.initialIndex), run, key: shownOrder(), ...showDrop(source, index ?? source.initialIndex, pointerDrag) });
  }}><div {...rest} ref={element => { list = element; local.ref?.(element); }} data-plain={local.plain ? "" : undefined} data-horizontal={local.horizontal ? "" : undefined}>{local.children}</div></DragDropProvider></SlotsContext.Provider>;
};

type ItemProps = Pick<UseSortableInput, "id" | "index" | "disabled"> & {
  /** The handle is also a button: a pointer drag starts after 4 px, so a click stays a click, and Space and Enter stay the button's own. */
  pressable?: boolean;
  children: (parts: ReturnType<typeof useSortable>) => JSX.Element;
};

/** What `Item` hands its row: the refs of the row and its handle, and the library's sortable. */
export type SortableParts = ReturnType<typeof useSortable>;

const Item = (props: ItemProps) => {
  const collisionDetector = useContext(SlotsContext);
  const sortable = useSortable(mergeProps(props, { transition: { duration: 0 } }, collisionDetector ? { collisionDetector } : {}, props.pressable ? { sensors: [pointerSensor()] } : {}));

  return props.children(sortable);
};

/** The library binds both pointer and keyboard activation to this independent control. `onLift` fires on the presses that can start a drag: pointer down, Space and Enter. */
const Handle = (props: { label: string; tooltip?: string; onLift?: () => void; ref: (element: HTMLButtonElement | undefined) => void }) => {
  onCleanup(() => props.ref(undefined));

  return <IconButton class="sortable-handle" data-reorderable="" aria-label={props.label} tooltip={props.tooltip} ref={props.ref} onPointerDown={() => props.onLift?.()} onClick={event => event.stopPropagation()} onKeyDown={event => {
    event.stopPropagation();

    if (event.key === " " || event.key === "Enter") props.onLift?.();
  }}><GripVertical aria-hidden="true" /></IconButton>;
};

export const Sortable = { Root, Item, Handle };

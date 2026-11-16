import { CollisionPriority, CollisionType, type CollisionDetector, type UniqueIdentifier } from "@dnd-kit/abstract";
import type { DragDropManager, Draggable, Droppable } from "@dnd-kit/dom";
import { isSortable } from "@dnd-kit/dom/sortable";
import { makeEventListener } from "@solid-primitives/event-listener";
import { scrollerOf } from "./scrollerOf";
import { depthSteps, stepLevel, type DepthReading, type DepthStep } from "./treeDrop";

/** Past this many pixels outside the list the preview shows no move; back inside the lower gap it follows again. */
const FAR_OUT_PX = 56;

const FAR_IN_PX = 40;

/** A drop slot changes hands only once the pointer is this share of a row nearer the other slot. */
const STICKY_ROW_SHARE = 0.25;

/**
 * Collision against the slots the rows had at lift, never the live boxes that move.
 * A pointer drag keeps the library's target on the dragged row itself, so the library moves no row in the DOM:
 * the other rows make room by `translate`, as a function of the pointer (`pose`), and the drop takes slot `slot()`.
 * Keyboard drags keep the library's own sorting.
 * Far from the list the slot is the row's own: nothing moves and a release puts it back.
 */
export const fixedSlots = (axis: "x" | "y", list: () => HTMLElement | undefined, depth: boolean) => {
  type Lift = { starts: number[]; sizes: number[]; size: number; box: DOMRect; ids: Set<UniqueIdentifier>; elements: Element[]; scroller: Element | null; offset: number };

  type Row = { id: UniqueIdentifier; index: number; element: Element | undefined };

  const offset = (scroller: Element | null) => scroller ? (axis === "x" ? scroller.scrollLeft : scroller.scrollTop) : 0;
  let lift: Lift | null = null;
  let dragged: { id: UniqueIdentifier; from: number; at: number; manager: DragDropManager } | null = null;
  let slot = -1;
  let far = false;
  let pointer: { x: number; y: number } | null = null;
  /** Whether a drop at index `to` is one the caller takes; the pointer picks only among those. */
  let allowed = (_to: number): boolean => true;
  // A tree drag's depth below or above the dragged row's own, read from the pointer's x against the steps of the slot it picks.
  let level = 0;
  let grabX = 0;
  let reading: DepthReading | undefined;
  let steps: { slot: number; lo: number; steps: DepthStep[] } | null = null;

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
    return { starts: rects.map(rect => rect[start] + offset(scroller)), sizes: rects.map(rect => rect[length]), size: rects[0]![length], box: new DOMRect(left, top, right - left, bottom - top), ids: new Set(shown.map(row => row.id)), elements: shown.map(row => row.element), scroller, offset: offset(scroller) };
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

  /** The lifted row's middle now, in scroll-content coordinates of the lift. */
  const liftedMiddle = () => startOf(dragged!.from, dragged!.from) + lift!.sizes[dragged!.from]! / 2 + (axis === "x" ? pointer!.x : pointer!.y) - dragged!.at + offset(lift!.scroller) - lift!.offset;

  /** The slot the pointer picks: the one nearest the lifted row's middle among those `allowed`, kept until another is past STICKY_ROW_SHARE of a row nearer. */
  const repick = (): number => {
    // The pick reads the lifted row's middle against its own middle at each slot, the places `pose` draws, so a tall row and the rows agree.
    const middle = liftedMiddle();
    const distance = (index: number) => Math.abs(startOf(dragged!.from, index) + lift!.sizes[dragged!.from]! / 2 - middle);
    const open = lift!.starts.map((_, index) => index).filter(allowed);
    const nearest = open.reduce((best, index) => distance(index) < distance(best) ? index : best, open[0] ?? -1);

    return nearest >= 0 && nearest !== slot && (!allowed(slot) || distance(slot) - distance(nearest) > STICKY_ROW_SHARE * lift!.size) ? nearest : slot;
  };

  // The pointer picks the slot nearest the dragged row; it changes hands only past STICKY_ROW_SHARE of a row.
  const update = () => {
    if (!dragged || !pointer) return;
    const rows = rowsOf();

    // A row that joined the list mid-drag makes new slots. One that leaves keeps its slot, and a row unregistered for a moment changes nothing.
    if (!lift || rows.some(row => !lift!.ids.has(row.id))) {
      lift = measure(rows);
      steps = null;

      if (!lift) return;
    }

    const { x, y } = pointer;
    const { box } = lift;
    // A tree takes its depth from how far the pointer sits beyond the list's end edge, so that overrun is no distance from the list.
    const gap = Math.hypot(Math.max(box.left - x, 0, depth && axis === "y" ? 0 : x - box.right), Math.max(box.top - y, 0, depth && axis === "x" ? 0 : y - box.bottom));

    far = far ? gap > FAR_IN_PX : gap > FAR_OUT_PX;

    slot = far ? dragged.from : repick();

    if (!reading) return;

    if (steps?.slot !== slot) {
      const { lo, hi } = reading.levels(slot);

      steps = { slot, lo, steps: depthSteps(grabX, reading.indent, lo, hi, reading.box) };
    }

    level = stepLevel(steps.steps, steps.lo, level, x);
  };

  /**
   * How far each row at lift shows from its place now: the dragged row's centre, moved by the pointer, sits between two slots,
   * and every other row stands that share of the way between its places for those two slots (the paper's `d.between`).
   */
  const startAt = (from: number, to: number): number | null => {
    if (!lift || from < 0 || to < 0 || to >= lift.starts.length || from >= lift.starts.length) return null;

    return startOf(from, to) - offset(lift.scroller);
  };

  const snapped = () => !!lift && lift.starts.some((_, index) => !allowed(index));

  const pose = (): number[] | null => {
    if (!lift || !dragged || !pointer) return null;
    const { from } = dragged;

    if (far) return lift.starts.map(() => 0);

    // Where the owner refuses some slots the rows stand at the slot picked, never between, so no gap opens where a release cannot land.
    if (snapped()) return shifts(from, slot);
    const centre = liftedMiddle();
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
  /** The detector also tells a row whether a keyboard drag may stop at index `to`: the drops the owner takes. */
  const detect = Object.assign(choose, { takes: (to: number) => allowed(to) }) as CollisionDetector & { takes: (to: number) => boolean };

  let posed: ((pose: number[]) => void) | undefined;

  const at = (x: number, y: number) => {
    pointer = { x, y };
    update();
    const now = pose();

    if (now) posed?.(now);
  };

  const scrolled = () => {
    update();
    const now = pose();

    if (now) posed?.(now);
  };

  const moved = (x: number, y: number) => { if (dragged) at(x, y); };

  return {
    detect,
    /** The drag's own report of the pointer, the one source of a move: `begin` starts the slot from where the pointer is when the drag starts. */
    moved,
    /** Limits the drops a pointer can pick to the indices `ok` takes, until the next call. */
    allow: (ok: (to: number) => boolean) => { allowed = ok; },
    isFar: () => far,
    /** The slot a pointer release takes now. */
    slot: () => slot,
    /** The dragged row's top edge at the slot it picked, in view coordinates, where the owner refuses some slots; else null. */
    snappedTop: (): number | null => dragged && snapped() ? startAt(dragged.from, slot) : null,
    /** Levels a tree drop sits deeper than the dragged row's own depth, negative for shallower. */
    level: () => level,
    /** Where the depth steps in the slot the pointer picks now. */
    steps: (): readonly DepthStep[] => steps?.steps ?? [],
    /** Where the dragged row's start edge shows once it sits at index `to`: the rows' places at lift, in view coordinates now. */
    startAt,
    /** How far each row shows from its place at lift once the row at `from` sits at `to`; the dragged row's own entry is its move. */
    shifts,
    /** The rows in their order at lift. */
    rowsAtLift: (): readonly Element[] => lift?.elements ?? [],
    /** Starts reading the pointer for one drag of `source`, grabbed at `grab`; `onPose` gets every row's offset as the pointer moves. With `depth` it also reads the drop's depth. Returns what stops it. */
    begin: (source: Draggable | null, grab: { x: number; y: number }, current: { x: number; y: number }, onPose: (pose: number[]) => void, depth?: DepthReading) => {
      lift = null; far = false; pointer = null; dragged = null; slot = -1; posed = onPose; level = 0; grabX = grab.x; reading = depth; steps = null;

      if (!isSortable(source) || !source.manager) return () => undefined;
      dragged = { id: source.id, from: source.initialIndex, at: axis === "x" ? grab.x : grab.y, manager: source.manager };
      slot = source.initialIndex;
      lift = measure(rowsOf());
      // The move that started the drag was made before this listener: the slot starts from where the pointer is now, not from the lift.
      pointer = { x: current.x, y: current.y };
      update();
      const stopScrolling = makeEventListener(window, "scroll", scrolled, { capture: true, passive: true });

      return () => {
        stopScrolling();
        posed = undefined;
      };
    },
  };
};

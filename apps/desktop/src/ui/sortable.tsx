import GripVertical from "@lucide/solid/icons/grip-vertical";
import { IconButton } from "./IconButton";
import { ReducedMotionContext } from "../app/reducedMotion";
import { clearPress } from "./pressFeedback";
import { captureFocus } from "../keys/focus";
import { dropLine } from "./dropLine";
import { pointerSensor } from "./pointerSensor";
import { fixedSlots } from "./fixedSlots";
import { depthReading, depthsAt, dropAt, gapAt, isInPlace, keyDrop, keyStart, keyTurn, legalIndexOf, resolveDrop, withDepth, type DropRules, type SortableDrop, type TreeRow } from "./treeDrop";
import { easingOut, glide, reorderMs, translateOf } from "./reorderMotion";
import "./sortable.css";
import { Accessibility, AutoScroller, Cursor, DragDropManager, Feedback, PointerSensor, type DragEndEvent, type DragMoveEvent, type DragStartEvent, type Draggable, type DropAnimationFunction } from "@dnd-kit/dom";
import type { CollisionDetector, Data } from "@dnd-kit/abstract";
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers";
import { showPopover } from "@dnd-kit/dom/utilities";
import { effect } from "@dnd-kit/state";
import { makeEventListener } from "@solid-primitives/event-listener";
import { isSortable, resolveSortableTransition, Sortable as LibrarySortable, type SortableInput } from "@dnd-kit/dom/sortable";
import { createContext, createEffect, createSignal, createMemo, flush, omit, onCleanup, onSettled, untrack, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";

/** Longest the dragged row waits at its new place for the Daemon's answer to show in the list. */
const ANSWER_WAIT_MS = 2500;

/** What a row reads from its list: the manager its sortable joins, the collision detector, and whether a keyboard drag may stop at index `to`. */
const ListContext = createContext<{ manager: DragDropManager; detect: CollisionDetector & { takes: (to: number) => boolean } }>();

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

/** A committed drop: `index` counts the parent's children without the dragged row. */
export type SortableMove = { id: string; parent: string | null; index: number };

/** Rows with a parent: a drop reports `onMove` instead of the flat order. */
type SortableTree = DropRules & {
  rows: readonly TreeRow[];
  /** One level of indentation in pixels: how far right of where the drag began picks the next deeper parent, or less where the room to `bounds` is short. */
  indent: number;
  /** The box a pointer drag picks depths in, in view coordinates; the window when absent. The deepest depth a gap allows steps in just inside its right edge. */
  bounds?: () => { left: number; right: number } | undefined;
  /** The row content's inset from its border box, in pixels, at its current depth. */
  inset: (element: HTMLElement) => number;
  /** Called with the dragged row's id as its drag starts, before the rows are measured, and with null once the drop is shown or the drag is cancelled: a caller may fold the row's children in between. */
  onLift?: (id: string | null, keyboard: boolean) => void;
  /** A string the promise resolves to is the Daemon's refusal; the dragged row then blends back once. */
  onMove: (move: SortableMove) => MoveAnswer;
  /** The drop a release would commit, or null once the drag ends. */
  onPreview: (drop: SortableDrop | null) => void;
  /** False when a pointer release would not land `move` as the line shows it (the Rail ignores a release outside it; Todos refuse a nest that makes a cycle): the drop then shows no line and commits nothing. */
  accepts?: (move: SortableMove) => boolean;
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

/** The click the browser sends after a pointer release would reach whatever lies under the pointer; this drops the next one. */
const swallowNextClick = (): (() => void) => {
  const swallow = (click: Event) => click.stopPropagation();
  const forget = () => window.removeEventListener("click", swallow, { capture: true });

  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(forget);

  return forget;
};

/**
 * In a tree the lift motion slides the rows once the Rail has redrawn, from where each one shows. The library's own index slide
 * starts from that motion's offset plus its own measure and would double it, so a tree's cancel stops the library's slides.
 */
const stopLibrarySlides = (source: Draggable | null, tree: SortableTree | undefined) => {
  if (!tree) return;

  for (const draggable of source?.manager?.registry.draggables ?? []) if (isSortable(draggable)) draggable.sortable.transition = null;
};

const Root = <T extends ExternalTarget>(props: RootProps<T>) => {
  const reduced = useContext(ReducedMotionContext) ?? (() => matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const rest = omit(props, "ids", "onOrderChange", "tree", "external", "plain", "horizontal", "ref", "onDrag", "children");
  let over: T | null = null;
  let list: HTMLDivElement | undefined;
  let stopTracking: (() => void) | undefined;
  let stopPointer: (() => void) | undefined;
  const slots = untrack(() => fixedSlots(props.horizontal ? "x" : "y", () => list, !!props.tree));

  // A drop shows its new order at once: the dragged row settles into the slot and waits there until the list itself shows the order, or the Daemon refuses.
  // The move itself runs once the row has landed (`run`): a list that redraws on a move then blocks no frame of the settle.
  let commit: { start: number | null; run: () => MoveAnswer; key: string; undo: () => void; clear: () => void } | null = null;

  /** Keeps `next` as the drop to commit; if no drop animation takes it within a second, it commits without one. */
  const hold = (next: NonNullable<typeof commit>) => {
    commit = next;
    setTimeout(() => { if (commit === next) { commit = null; next.run(); next.clear(); } }, 1000);
  };

  const shownOrder = createMemo(() => props.tree ? props.tree.rows.map(row => `${row.id}>${row.parent}`).join() : props.ids.join());
  const arrivals = new Set<() => void>();

  // The rows' offsets go in the same update that redraws the list: a list that slides its rows reads where they show before it redraws and again after.
  // The list moves the dropped row's node when it shows the move, which drops focus; the handle takes it back.
  let refocus: HTMLElement | null = null;

  createEffect(shownOrder, () => {
    for (const arrive of arrivals) arrive();

    if (refocus?.isConnected && document.activeElement === document.body) refocus.focus();
    refocus = null;
  }, { defer: true });

  const along = (shift: number) => `${props.horizontal ? shift : 0}px ${props.horizontal ? 0 : shift}px`;
  const slides = new WeakMap<Element, Animation>();

  /** Shows each row `shift` px from its place: at once, or sliding from where it shows now. Reads every row before it writes one. */
  const place = (rows: readonly { element: HTMLElement; shift: number }[], slide: boolean) => {
    const from = slide ? rows.map(({ element }) => { const now = translateOf(element);

 return props.horizontal ? now.x : now.y; }) : [];

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
    flush();

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

      return props.horizontal ? { x: dragged.start, y: box.y } : { x: box.x, y: dragged.start };
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

  // A keyboard drag shifts the dragged row's gap right of where it began by the drop's depth; a pointer drag's line shows the depth, and the dragged row stays at the pointer.
  const preview = (drop: SortableDrop | null) => {
    if (drop?.parent === previewed?.parent && drop?.index === previewed?.index && drop?.depth === previewed?.depth) return;

    previewed = drop;

    if (props.tree && keyboard) list?.style.setProperty("--sortable-shift", `${((drop?.depth ?? ownDepth) - ownDepth) * props.tree.indent}px`);
    props.tree?.onPreview(drop);
  };

  /** The drop for the gap before index `index` of the dragged row: a keyboard drag at its own depth, else `level` levels from the row's own depth. */
  const resolve = (tree: SortableTree, dragged: string, index: number, level: number) => {
    const out = resolveDrop(tree, dragged, index, level, keyboard, legalAt);

    keyboard = out.keyboard;
    legalAt = out.gap;

    return out;
  };

  /** The gap the last resolve took, for the direction of a key past a refused one. */
  let legalAt = 0;

  const legalIndex = legalIndexOf();

  /** A keyboard drag in a tree: ArrowLeft and ArrowRight pick the depth among those the owner takes for the gap the row stands at. */
  const holdKeys = (tree: SortableTree, dragged: string) => {
    keyboard = keyStart(tree.rows, dragged);
    legalAt = keyboard.slot;

    const turn = (key: KeyboardEvent) => {
      if (!keyboard || (key.key !== "ArrowLeft" && key.key !== "ArrowRight")) return;
      key.preventDefault();
      key.stopPropagation();
      keyboard = keyTurn(tree, dragged, keyboard, key.key === "ArrowRight" ? 1 : -1);
      preview(keyDrop(tree, dragged, keyboard));
    };

    stopListening = makeEventListener(window, "keydown", turn, { capture: true });
  };

  /** The pose callback of a pointer drag of `source`: the other rows follow the pointer, sliding when the far zone flips or, where the owner refuses slots, from slot to slot. */
  const follow = (source: Draggable | null) => {
    let wasFar = false;
    let lastSlot = source && isSortable(source) ? source.initialIndex : -1;

    return (pose: number[]) => {
      const far = slots.isFar();
      const settled = slots.snappedTop() !== null ? slots.slot() : lastSlot;

      place(others(source).map(({ element, index }) => ({ element, shift: pose[index] ?? 0 })), far !== wasFar || settled !== lastSlot);
      lastSlot = settled;
      wasFar = far;
      const top = slots.snappedTop();

      if (picking && top !== null) line.ride(top);
      list?.setAttribute("data-sortable-index", String(slots.slot()));
      showPick(source);
    };
  };

  /** Starts the lifted row's motion: the other rows' transitions, the line of a pointer drag in a tree, and the tracking of the drop. */
  const grab = (source: Draggable, element: HTMLElement, tree: SortableTree | undefined, pointerLift: boolean) => {
    const duration = !pointerLift || reduced() ? 0 : reorderMs(element);
    const easing = easingOut(element);

    // The other rows make room by sortable transitions; the dragged row follows the pointer with none.
    for (const draggable of source.manager?.registry.draggables ?? []) {
      if (isSortable(draggable)) draggable.sortable.transition = { duration: draggable === source ? 0 : duration, easing };
    }

    ownDepth = tree ? withDepth(tree.rows).find(row => row.id === String(source.id))?.depth ?? 0 : 0;

    if (tree && pointerLift) {
      const frame = () => { painted = picked; latch = requestAnimationFrame(frame); };

      picking = true;
      openLine(element);
      showPick(source);
      latch = requestAnimationFrame(frame);
    }

    stopTracking = effect(() => {
      const position = source.manager?.dragOperation.position;

      if (!isSortable(source)) return;
      const index = indexOf(source);

      // A pointer drag moves no row in the library: the slot the pointer takes is the index.
      list?.setAttribute("data-sortable-index", String(pointerLift ? slots.slot() : index));

      track(source);

      // The line rides the dragged row's top edge: the library moves the row in this same update, so both show on one frame.
      if (picking && position) line.ride(slots.snappedTop() ?? lineTop + position.current.y - position.initial.y);
    });
  };

  /** The index a drop gives the dragged row: the library's for a keyboard drag, the slot under the pointer otherwise. */
  const indexOf = (source: Draggable & { index: number }) => source.manager?.dragOperation.activatorEvent instanceof KeyboardEvent ? source.index : slots.slot();

  // A keyboard drag's drop follows its keys; a pointer drag's is its pick (`showPick`).
  const track = (source: Draggable | null) => {
    const tree = props.tree;

    if (!tree || !isSortable(source) || !keyboard) return;
    preview(resolve(tree, String(source.id), source.index, 0).drop);
  };

  // A pointer drag in a tree picks its drop as the pointer moves: the gap at the drop slot, at the depth the pointer's band gives, clamped to what the gap allows.
  // One line draws the pick, and a release commits the pick the last painted frame showed, so a drop never lands where no frame showed it.
  type Pick = { index: number; drop: SortableDrop };

  let picking = false;
  let picked: Pick | null = null;
  let painted: Pick | null = null;
  let latch = 0;
  const samePick = (a: Pick | null, b: Pick | null) => a === b || (!!a && !!b && a.index === b.index && a.drop.parent === b.drop.parent && a.drop.index === b.drop.index && a.drop.depth === b.drop.depth);

  const line = dropLine(offsetTo, () => ({ duration: reduced() ? 0 : reorderMs(document.documentElement), easing: easingOut() }));
  // Where the line starts at the dragged row's own depth, in view coordinates.
  let lineStart = 0;
  // The dragged row's top at lift, in view coordinates.
  let lineTop = 0;

  /** Draws `pick` with the line, starting at the inset a row at its depth has; with no pick it fades out where it is. */
  const drawPick = (pick: Pick | null) => {
    const x = pick && props.tree ? lineStart + (pick.drop.depth - ownDepth) * props.tree.indent : null;

    line.place(x, pick ? `${pick.index} ${pick.drop.depth} ${pick.drop.parent ?? ""}` : "");
  };

  /** Picks the drop for the pointer now and draws it when it changes. */
  const showPick = (source: Draggable | null) => {
    const tree = props.tree;

    if (!picking || !tree || !isSortable(source)) return;
    const id = String(source.id), index = slots.slot();
    const { rows, drop } = resolve(tree, id, index, slots.level());
    const next = slots.isFar() || over || (!isInPlace(rows, id, drop) && tree.accepts?.({ id, parent: drop.parent, index: drop.index }) === false) ? null : { index, drop };

    line.steps(slots.steps());

    if (samePick(next, picked)) return;
    picked = next;
    drawPick(next);

    if (next) preview(next.drop);
  };

  /** Opens the line for one pointer drag of `row` along the row's top edge, as wide as the row at lift, so it ends at the row's right edge. */
  const openLine = (row: HTMLElement) => {
    if (!props.tree) return;
    const box = row.getBoundingClientRect();

    lineStart = box.left + props.tree.inset(row);
    lineTop = box.top;
    line.open(box);
    line.ride(box.top);
  };

  const mark = (next: T | null) => {
    const attributeOf = (target: T | null) => target?.attribute ?? props.external?.attribute ?? "data-drop";

    if (next?.element !== over?.element) {
      if (over) over.element.removeAttribute(attributeOf(over));

      if (next) next.element.setAttribute(attributeOf(next), "");
    }

    over = next;
  };

  let stopRestoringFocus: (() => void) | undefined;

  // Where the dragged row stands among its siblings when its drag is about to start: the library's own sorting (a keyboard drag) moves it in the DOM.
  let stood: { previous: Element | null; next: Element | null; parent: Element | null } | null = null;

  const savePosition = (element: Element) => { stood = { previous: element.previousElementSibling, next: element.nextElementSibling, parent: element.parentElement }; };

  const restorePosition = (element: Element) => {
    if (!stood) return;
    const { previous, next, parent } = stood;

    if (previous && element.previousElementSibling !== previous) previous.insertAdjacentElement("afterend", element);
    else if (next && element.nextElementSibling !== next) next.insertAdjacentElement("beforebegin", element);
    else if (!previous && !next && parent) parent.appendChild(element);
  };

  // `restorePosition` puts the dragged row back next to the elements it had at lift, but the library's placeholder now follows it,
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

  const onDragStart = (event: DragStartEvent) => {
    const tree = props.tree;
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

    // The children fold before the rows are measured, so the slots are those of the folded list.
    if (tree && source) tree.onLift?.(String(source.id), event.operation.activatorEvent instanceof KeyboardEvent);
    flush();

    slots.allow(tree && source ? (to) => legalIndex(tree, String(source.id), to) : () => true);
    lifted = source?.element?.parentNode ? { element: source.element, parent: source.element.parentNode, before: source.element.previousSibling } : null;
    const pointerLift = !(event.operation.activatorEvent instanceof KeyboardEvent);

    picking = false;
    picked = null;
    painted = null;
    cancelAnimationFrame(latch);

    // The other rows follow the pointer; they slide only when the far zone flips. In a tree the pointer also picks the drop's depth.
    stopPointer = slots.begin(source, event.operation.position.initial, event.operation.position.current, follow(source), tree && pointerLift && isSortable(source) ? depthReading(tree, String(source.id), window.innerWidth) : undefined);

    if (!(event.operation.activatorEvent instanceof KeyboardEvent)) unclip(slots.rowsAtLift());

    if (source?.element instanceof HTMLElement) grab(source, source.element, tree, pointerLift);

    stopListening?.();
    props.onDrag?.(true);

    if (!tree || !isSortable(source) || !(event.operation.activatorEvent instanceof KeyboardEvent)) {
      keyboard = null;

      return;
    }

    holdKeys(tree, String(source.id));
  };

  const onDragMove = (event: DragMoveEvent) => {
    const { source, position } = event.operation;

    // The library dispatches dragmove before it applies the move, so the destination is `to`, else the current position plus `by`.
    const x = event.to?.x ?? position.current.x + (event.by?.x ?? 0);
    const y = event.to?.y ?? position.current.y + (event.by?.y ?? 0);

    if (!(event.operation.activatorEvent instanceof KeyboardEvent)) slots.moved(x, y);
    track(source);

    if (!props.external || !source) return;
    mark(props.external.target(String(source.id), x, y));
    showPick(source);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const source = event.operation.source;
    const outside = over;
    const pointerDrag = !(event.operation.activatorEvent instanceof KeyboardEvent);
    const far = pointerDrag && slots.isFar();
    // A tree's pointer drop is the pick the last painted frame showed, unless the release itself falls where nothing drops (far, outside or refused).
    const shown = picked && (painted ?? picked);

    cancelAnimationFrame(latch);

    if (picking) line.close();
    picking = false;
    picked = null;
    painted = null;

    unmoveLifted();
    lifted = null;

    clearPreview();
    stopPointer?.();
    stopPointer = undefined;

    mark(null);
    props.onDrag?.(false);
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

    const tree = props.tree;
    const point = event.operation.position.current;

    // The preview shows what a release commits: far from the list it shows no move, and nothing commits.
    const index = isSortable(source) ? tree && pointerDrag ? shown?.index ?? source.initialIndex : pointerDrag && event.operation.shape?.initial.containsPoint(point) ? source.initialIndex : pointerDrag ? slots.slot() : source.index : null;

    // A pointer release that commits nothing sends the other rows back.
    const relax = () => {
      stopLibrarySlides(source, tree);
      tree?.onLift?.(null, !pointerDrag);

      if (pointerDrag) { place(others(source).map(({ element }) => ({ element, shift: 0 })), !tree); reclipAfterSlide(); }
    };

    const final = !tree || event.canceled || !isSortable(source) ? null
      : pointerDrag ? shown && { rows: withDepth(tree.rows), drop: shown.drop }
      : resolve(tree, String(source.id), index ?? source.index, 0);

    keyboard = null;
    previewed = null;
    tree?.onPreview(null);

    if (pointerDrag) swallowNextClick();

    // The row ends over another list: the list's glide (U3311) is its one motion, so the library's drop animation stays off.
    if (outside && source && props.external) {
      const feedback = source.manager?.registry.plugins.get(Feedback);

      if (feedback) feedback.dropAnimation = null;
    }

    if (event.canceled) { relax();

 return; }

    if (outside && source && props.external) {
      relax();
      props.external.onDropOutside(String(source.id), outside);

      return;
    }

    if (tree) {
      if (final && !isInPlace(final.rows, String(source?.id), final.drop)) {
        const run = () => {
          const answer = tree.onMove({ id: String(source?.id), parent: final.drop.parent, index: final.drop.index });

          tree.onLift?.(null, !pointerDrag);

          return answer;
        };

        if (isSortable(source)) hold({ start: slots.startAt(source.initialIndex, index ?? source.index), run, key: shownOrder(), ...showDrop(source, index ?? source.index, pointerDrag) });
        else run();
      } else relax();

      return;
    }

    if (far || !isSortable(source) || source.initialIndex === index) { relax();

 return; }

    const order = [...props.ids];
    const [moved] = order.splice(source.initialIndex, 1);

    if (moved === undefined) { relax();

 return; }

    order.splice(index ?? source.initialIndex, 0, moved);
    const run = () => props.onOrderChange?.(order, String(source.id));

    hold({ start: slots.startAt(source.initialIndex, index ?? source.initialIndex), run, key: shownOrder(), ...showDrop(source, index ?? source.initialIndex, pointerDrag) });
  };

  const manager = untrack(() => new DragDropManager({
    sensors: defaults => defaults.map(sensor => sensor === PointerSensor ? pointerSensor() : sensor),
    modifiers: props.horizontal ? [RestrictToHorizontalAxis] : [],
    plugins: (defaults) => defaults.filter((plugin) => plugin !== Cursor && !(props.plain && plugin === Accessibility) && !(props.horizontal && plugin === AutoScroller)).map((plugin) => plugin === Feedback ? Feedback.configure({ dropAnimation: settle, keyboardTransition: null }) : plugin === AutoScroller ? AutoScroller.configure({ threshold: { x: 0, y: 0.2 } }) : plugin),
  }));

  const context = { manager, detect: slots.detect };

  // A handler that changes the list is drawn before the library goes on: it measures the rows once a handler returns.
  const stopMonitoring = [
    // listener-owner: the drag manager's monitor, not a DOM target; the cleanup below unsubscribes it.
    manager.monitor.addEventListener("beforedragstart", ({ operation: { source } }) => { if (isSortable(source) && source.element) savePosition(source.element); }),
    // listener-owner: the drag manager's monitor, not a DOM target; the cleanup below unsubscribes it.
    manager.monitor.addEventListener("dragstart", onDragStart),
    // listener-owner: the drag manager's monitor, not a DOM target; the cleanup below unsubscribes it.
    manager.monitor.addEventListener("dragmove", (event) => flush(() => onDragMove(event))),
    // listener-owner: the drag manager's monitor, not a DOM target; the cleanup below unsubscribes it.
    manager.monitor.addEventListener("dragend", (event) => {
      const { source } = event.operation;

      if (isSortable(source) && source.element) restorePosition(source.element);
      flush(() => onDragEnd(event));
      stood = null;
    }),
  ];

  onCleanup(() => { for (const stop of stopMonitoring) stop(); manager.destroy(); clearPreview(); stopPointer?.(); stopRestoringFocus?.(); stopListening?.(); mark(null); reclip(); cancelAnimationFrame(latch); line.remove(); });

  return <ListContext value={context}><div {...rest} ref={element => { list = element; props.ref?.(element); }} data-plain={props.plain ? "" : undefined} data-horizontal={props.horizontal ? "" : undefined}>{props.children}</div>{props.tree ? <div class="sortable-line" popover="manual" aria-hidden="true" ref={line.box}><div class="sortable-line-bar" ref={line.bar} /></div> : null}</ListContext>;
};

type ItemProps = Pick<SortableInput<Data>, "id" | "index" | "disabled"> & {
  /** The row holds a slot others can land on but cannot be lifted: it has no drag activator, so it is announced neither draggable nor disabled. */
  fixed?: boolean;
  /** The handle is also a button: a pointer drag starts after 4 px, so a click stays a click, and Space and Enter stay the button's own. */
  pressable?: boolean;
  children: (parts: SortableParts) => JSX.Element;
};

/** What `Item` hands its row: the refs of the row and its handle, and the library's sortable. */
export type SortableParts = {
  sortable: LibrarySortable;
  isDragging: () => boolean;
  ref: (element: Element | undefined) => void;
  handleRef: (element: Element | undefined) => void;
};

const Item = (props: ItemProps) => {
  const { manager, detect } = useContext(ListContext);
  const [dragging, setDragging] = createSignal(false);
  const fixed = untrack(() => props.fixed);

  // A keyboard drag's next target skips the rows whose index the owner refuses: the library then moves the row to the next index it takes.
  const sortable: LibrarySortable = untrack(() => {
    const input: ConstructorParameters<typeof LibrarySortable>[0] = {
      id: props.id,
      index: props.index,
      disabled: props.disabled ?? false,
      transition: resolveSortableTransition({ duration: 0 }),
      collisionDetector: detect,
      accept: (): boolean => detect.takes(sortable.index),
      register: false,
    };

    if (props.pressable) input.sensors = [pointerSensor()];

    return new LibrarySortable(input, manager);
  });

  createEffect(() => [props.id, props.disabled ?? false] as const, ([id, disabled]) => { sortable.id = id; sortable.disabled = disabled; });
  createEffect(() => props.index, (index) => { sortable.index = index; });

  onSettled(() => {
    const stopDragging = effect(() => { setDragging(sortable.isDragging); });
    const unregister = sortable.register();

    return () => { stopDragging(); unregister(); };
  });

  return untrack(() => props.children({
    sortable,
    isDragging: dragging,
    ref: (element) => {
      if (!element) return;
      sortable.element = element;

      // The row stays a drop slot (its element is the droppable's) but the draggable gets none, so the library binds no activator to it.
      if (fixed) sortable.source = undefined;
    },
    handleRef: (handle) => { if (handle) sortable.handle = handle; },
  }));
};

/** The library binds both pointer and keyboard activation to this independent control. `onLift` fires on the presses that can start a drag: pointer down, Space and Enter. The row beside it names what moves, so it shows no tooltip (U6614a). */
const Handle = (props: { label: string; onLift?: () => void; ref: (element: HTMLButtonElement | undefined) => void }) => {
  onCleanup(() => props.ref(undefined));

  return <IconButton class="sortable-handle" data-reorderable="" aria-label={props.label} bare ref={props.ref} onPointerDown={() => props.onLift?.()} onClick={event => event.stopPropagation()} onKeyDown={event => {
    event.stopPropagation();

    if (event.key === " " || event.key === "Enter") props.onLift?.();
  }}><GripVertical aria-hidden="true" /></IconButton>;
};

export const Sortable = { Root, Item, Handle };

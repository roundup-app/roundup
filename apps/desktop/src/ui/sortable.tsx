import "./sortable.css";
import { Accessibility, Cursor, Droppable, Feedback, KeyboardSensor, PointerActivationConstraints, PointerSensor, type Draggable } from "@dnd-kit/dom";
import { effect } from "@dnd-kit/state";
import { DragDropProvider, DragOverlay } from "@dnd-kit/solid";
import { isSortable } from "@dnd-kit/dom/sortable";
import { useSortable, type UseSortableInput } from "@dnd-kit/solid/sortable";
import { createSignal, mergeProps, onCleanup, splitProps, type JSX } from "solid-js";

/** A press that moves less than this is a click. */
const PRESS_DRAG_PX = 4;

/** A drop target outside the list; `element` carries `data-drop` while the pointer is over it. */
type ExternalTarget = { element: HTMLElement; /** Carried instead of the list's `attribute` while the pointer is over this target. */ attribute?: string };

type External<T extends ExternalTarget> = {
  /** The target under the pointer for a dragged row, else null. */
  target: (id: string, x: number, y: number) => T | null;
  onDropOutside: (id: string, target: T) => void;
  /** The attribute the target carries while the pointer is over it; default `data-drop`. */
  attribute?: string;
};

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
  nests: (id: string) => boolean;
  onMove: (move: SortableMove) => void;
  /** The drop a release would commit, or null once the drag ends. */
  onPreview: (drop: SortableDrop | null) => void;
};

type RootProps<T extends ExternalTarget> = Omit<JSX.HTMLAttributes<HTMLDivElement>, "onDrag"> & {
  ids: readonly string[];
  /** The flat order after a drop; not called when `tree` is given. */
  onOrderChange?: ((ids: string[]) => void) | undefined;
  tree?: SortableTree | undefined;
  external?: External<T> | undefined;
  /** The handles are buttons that keep their own meaning: the library adds no live region and no `aria-pressed`, `aria-grabbed`, `aria-disabled`, role description or description to them. */
  plain?: boolean;
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
  const [local, rest] = splitProps(props, ["ids", "onOrderChange", "tree", "external", "plain", "onDrag", "children"]);
  let over: T | null = null;
  let list: HTMLDivElement | undefined;
  let projectedIndex: number | null = null;
  let sourceRow: HTMLElement | null = null;
  let slot: HTMLDivElement | null = null;
  let slotTarget: Droppable | null = null;
  let sourceHeight = 0;
  let keyboardDrag = false;
  let sourceDepth = 0;
  let sourceIndent = 0;
  let slotFrame: number | undefined;
  let paddingEnd = "";
  let originLeft = 0;
  let overlayWidth = 0;
  const [clip, setClip] = createSignal("inset(0)");
  const retiring = new Set<HTMLElement>();

  const clearSlot = (fade = false) => {
    if (slotFrame !== undefined) cancelAnimationFrame(slotFrame);

    slotTarget?.destroy();
    slotTarget = null;
    const leaving = slot;

    if (fade && leaving?.isConnected) {
      const at = leaving.getBoundingClientRect();

      leaving.removeAttribute("data-dnd-placeholder");
      Object.assign(leaving.style, { position: "fixed", top: `${at.top}px`, left: `${at.left}px`, width: `${at.width}px`, margin: "0" });
      leaving.removeAttribute("data-open");
      retiring.add(leaving);
      // Reading animations flushes the reversed transition, including an interrupted entrance.
      void Promise.allSettled(leaving.getAnimations().map(animation => animation.finished)).then(() => {
        leaving.remove();
        retiring.delete(leaving);
      });
    } else leaving?.remove();
    slot = null;
    sourceRow?.removeAttribute("data-sortable-source");
    sourceRow = null;

    if (list) {
      list.style.paddingBlockEnd = paddingEnd;
      delete list.dataset.sortableIndex;
    }
  };

  // The library owns collision targets; this empty slot only reserves their landing space.
  const placeSlot = (source: Draggable, index: number, depth = sourceDepth) => {
    if (!list || !sourceRow || !slot || !isSortable(source)) return;
    const targetId = local.ids[index];
    const target = Array.from(source.manager?.registry.droppables ?? []).find(row => row.id === targetId)?.element;

    if (!target) return;

    if (index === source.initialIndex && slot.hidden) return;

    slot.hidden = false;

    list.style.paddingBlockEnd = paddingEnd;

    const before = index < source.initialIndex;
    const anchor = before ? target : target.nextSibling;

    if (anchor !== slot && (slot.parentElement !== target.parentElement || slot.nextSibling !== anchor)) target.parentElement?.insertBefore(slot, anchor);
    slot.style.marginInlineStart = `${Math.max(0, sourceIndent + (depth - sourceDepth) * (local.tree?.indent ?? 0))}px`;
    list.dataset.sortableIndex = String(index);
  };

  // Keyboard drags choose depth with ArrowLeft and ArrowRight; `slot` is the gap `depth` belongs to.
  let keyboard: { slot: number; depth: number } | null = null;
  let previewed: SortableDrop | null = null;
  let stopListening: (() => void) | undefined;

  const preview = (drop: SortableDrop | null) => {
    if (drop?.parent === previewed?.parent && drop?.index === previewed?.index && drop?.depth === previewed?.depth) return;

    previewed = drop;

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

  const track = (source: Draggable | null, position: { initial: { x: number }; current: { x: number } }) => {
    const tree = local.tree;

    if (!tree || !isSortable(source)) return;
    const { drop } = resolve(tree, String(source.id), projectedIndex ?? source.index, { initial: position.initial.x, current: position.current.x });
    preview(drop);
    placeSlot(source, projectedIndex ?? source.index, drop.depth);
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

  onCleanup(() => {
    clearSlot();

    for (const leaving of retiring) leaving.remove();
    stopRestoringFocus?.();
    stopListening?.();
    mark(null);
  });

  return <DragDropProvider onDragOver={(event) => {
    // Prevent the library's optimistic DOM swaps: the real source and every sibling stay in order.
    event.preventDefault();
    const { source, target, position } = event.operation;

    if (!keyboardDrag && isSortable(source) && isSortable(target)) {
      projectedIndex = target.index;
      placeSlot(source, target.index);
      track(source, position);
    }
  }} onDragStart={(event) => {
    const tree = local.tree;
    const source = event.operation.source;

    previewed = null;

    if (list && !sourceRow) paddingEnd = list.style.paddingBlockEnd;

    clearSlot();
    projectedIndex = isSortable(source) ? source.index : null;
    keyboardDrag = event.operation.activatorEvent instanceof KeyboardEvent;

    if (isSortable(source) && source.element instanceof HTMLElement) {
      sourceRow = source.element;
      const box = sourceRow.getBoundingClientRect();

      sourceHeight = box.height;
      originLeft = box.left - event.operation.position.initial.x;
      overlayWidth = box.width;
      setClip("inset(0)");
      sourceDepth = tree ? withDepth(tree.rows).find(row => row.id === String(source.id))?.depth ?? 0 : 0;
      sourceIndent = tree ? sourceDepth * tree.indent : 0;
      sourceRow.setAttribute("data-sortable-source", "");
      slot = document.createElement("div");
      slot.className = "sortable-slot";
      slot.hidden = true;
      list?.append(slot);
      slot.setAttribute("data-dnd-placeholder", "");
      slot.setAttribute("aria-hidden", "true");
      slot.style.height = `${sourceHeight}px`;
      slot.dataset.keyboard = String(event.operation.activatorEvent instanceof KeyboardEvent);
      slotTarget = new Droppable({ id: `sortable-slot-${source.id}`, element: slot, collisionPriority: 100 }, source.manager);

      if (list) {
        paddingEnd = list.style.paddingBlockEnd;
        list.style.paddingBlockEnd = `${parseFloat(getComputedStyle(list).paddingBlockEnd) + sourceHeight}px`;
      }

      slotFrame = requestAnimationFrame(() => slot?.setAttribute("data-open", ""));
    }

    stopListening?.();
    local.onDrag?.(true);

    if (!isSortable(source) || !keyboardDrag) {
      keyboard = null;

      return;
    }

    const rows = tree ? withDepth(tree.rows) : [];
    const remaining = remainingRows(rows, String(source.id));
    const own = rows.find(row => row.id === String(source.id));

    keyboard = tree && own ? { slot: rows.slice(0, rows.indexOf(own)).filter(row => remaining.includes(row)).length, depth: own.depth } : null;

    // Arrow commands select the same library target indexes without moving real rows.
    // Space/Escape and focus still belong to the library's keyboard sensor.
    const turn = (key: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key.key)) return;
      key.preventDefault();
      key.stopPropagation();

      if (key.key === "ArrowUp" || key.key === "ArrowDown") {
        projectedIndex = Math.min(Math.max((projectedIndex ?? source.index) + (key.key === "ArrowDown" ? 1 : -1), 0), local.ids.length - 1);
        placeSlot(source, projectedIndex);
        track(source, event.operation.position);
        slot?.scrollIntoView({ block: "nearest" });

        return;
      }

      if (!keyboard || !tree) return;
      const { min, max } = depthsAt(remaining, tree.nests, keyboard.slot);

      keyboard = { slot: keyboard.slot, depth: Math.min(Math.max(keyboard.depth + (key.key === "ArrowRight" ? 1 : -1), min), max) };
      const drop = dropAt(remaining, tree.nests, keyboard.slot, keyboard.depth);

      preview(drop);
      placeSlot(source, projectedIndex ?? source.index, drop.depth);
    };

    window.addEventListener("keydown", turn, { capture: true });
    stopListening = () => window.removeEventListener("keydown", turn, { capture: true });
  }} plugins={(defaults) => defaults.filter((plugin) => plugin !== Cursor && !(local.plain && plugin === Accessibility)).map((plugin) => plugin === Feedback ? Feedback.configure({ dropAnimation: null, keyboardTransition: null }) : plugin)} onDragMove={(event) => {
    const { source, position } = event.operation;

    // The library dispatches dragmove before it applies the move, so the destination is `to`, else the current position plus `by`.
    const x = event.to?.x ?? position.current.x + (event.by?.x ?? 0);
    const y = event.to?.y ?? position.current.y + (event.by?.y ?? 0);

    const bounds = list?.getBoundingClientRect();

    if (bounds) setClip(`inset(0 ${Math.max(0, x + originLeft + overlayWidth - bounds.right)}px 0 ${Math.max(0, bounds.left - x - originLeft)}px)`);
    track(source, { initial: position.initial, current: { x } });

    if (!local.external || !source) return;
    mark(local.external.target(String(source.id), x, y));
  }} onDragEnd={(event) => {
    const source = event.operation.source;
    const outside = over;
    const pointerDrag = !(event.operation.activatorEvent instanceof KeyboardEvent);

    mark(null);
    local.onDrag?.(false);
    stopListening?.();
    stopListening = undefined;

    const handle = source?.handle;

    if (source && handle instanceof HTMLElement) {
      stopRestoringFocus?.();
      stopRestoringFocus = effect(() => {
        if (source.status !== "idle") return;
        // Idle precedes the library replacing its placeholder; focus after that replacement.
        queueMicrotask(() => {
          stopRestoringFocus?.();

          if (handle.isConnected) handle.focus();
        });
      });
    }

    const tree = local.tree;
    const point = event.operation.position.current;
    const box = list?.getBoundingClientRect();
    const inside = !pointerDrag || (box && point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom);

    const final = tree && inside && !event.canceled && isSortable(source)
      ? resolve(tree, String(source.id), projectedIndex ?? source.index, { initial: event.operation.position.initial.x, current: event.operation.position.current.x })
      : null;

    clearSlot(true);

    const projected = projectedIndex;
    projectedIndex = null;
    keyboard = null;
    previewed = null;
    tree?.onPreview(null);

    if (pointerDrag) swallowNextClick();

    if (event.canceled) return;

    if (outside && source && local.external) {
      local.external.onDropOutside(String(source.id), outside);

      return;
    }

    if (tree) {
      if (final && !isInPlace(final.rows, String(source?.id), final.drop)) tree.onMove({ id: String(source?.id), parent: final.drop.parent, index: final.drop.index });

      return;
    }

    if (!isSortable(source) || projected === null || source.initialIndex === projected) return;
    const order = [...local.ids];
    const [moved] = order.splice(source.initialIndex, 1);

    if (moved === undefined) return;
    order.splice(projected, 0, moved);
    local.onOrderChange?.(order);
  }}><div {...rest} ref={list} data-plain={local.plain ? "" : undefined}>{local.children}</div><DragOverlay class="sortable-overlay" style={{ "clip-path": clip() }} dropAnimation={null}>{source => <span>{source.element?.querySelector("[data-reads=\"text\"]")?.textContent ?? source.handle?.textContent ?? source.element?.textContent}</span>}</DragOverlay></DragDropProvider>;
};

type ItemProps = Pick<UseSortableInput, "id" | "index" | "disabled"> & {
  /** The handle is also a button: a pointer drag starts after 4 px, so a click stays a click, and Space and Enter stay the button's own. */
  pressable?: boolean;
  children: (parts: ReturnType<typeof useSortable>) => JSX.Element;
};

const Item = (props: ItemProps) => {
  const sensors = [
    PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: PRESS_DRAG_PX })] }),
    ...(props.pressable ? [] : [KeyboardSensor]),
  ];

  const sortable = useSortable(mergeProps(props, { sensors }));

  return props.children(sortable);
};

export const Sortable = { Root, Item };

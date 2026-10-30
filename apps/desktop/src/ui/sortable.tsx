import GripVertical from "lucide-solid/icons/grip-vertical";
import { IconButton } from "./IconButton";
import { ReducedMotionContext } from "../app/reducedMotion";
import { clearPress } from "./pressFeedback";
import { captureFocus } from "../keys/focus";
import "./sortable.css";
import { Accessibility, Cursor, Feedback, PointerActivationConstraints, PointerSensor, type Draggable } from "@dnd-kit/dom";
import { RestrictToElement } from "@dnd-kit/dom/modifiers";
import { ProxiedElements } from "@dnd-kit/dom/utilities";
import { effect } from "@dnd-kit/state";
import { DragDropProvider, DragOverlay } from "@dnd-kit/solid";
import { isSortable } from "@dnd-kit/dom/sortable";
import { useSortable, type UseSortableInput } from "@dnd-kit/solid/sortable";
import { mergeProps, onCleanup, splitProps, useContext, type JSX } from "solid-js";

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
  /** The row content's inset from its border box, in pixels, at its current depth. */
  inset: (element: HTMLElement) => number;
  nests: (id: string) => boolean;
  onMove: (move: SortableMove) => void;
  /** The drop a release would commit, or null once the drag ends. */
  onPreview: (drop: SortableDrop | null) => void;
};

type RootProps<T extends ExternalTarget> = Omit<JSX.HTMLAttributes<HTMLDivElement>, "onDrag"> & {
  ids: readonly string[];
  /** The flat order after a drop; not called when `tree` is given. */
  onOrderChange?: ((ids: string[], moved: string) => void) | undefined;
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
  const reduced = useContext(ReducedMotionContext) ?? (() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [local, rest] = splitProps(props, ["ids", "onOrderChange", "tree", "external", "plain", "onDrag", "children"]);
  let over: T | null = null;
  let list: HTMLDivElement | undefined;
  let sourceRow: HTMLElement | null = null;
  let slot: HTMLDivElement | null = null;
  let stopTracking: (() => void) | undefined;
  let restoreSource: (() => void) | undefined;
  let closingSlot: HTMLDivElement | null = null;

  // Keyboard drags choose depth with ArrowLeft and ArrowRight; `slot` is the gap `depth` belongs to.
  let keyboard: { slot: number; depth: number } | null = null;
  let previewed: SortableDrop | null = null;
  let landingRows: { id: string; element: HTMLElement }[] = [];

  // Measure a real destination row at this depth, so nested DOM containers and
  // list insets cannot add indentation a second time to the library's proxy.
  const placeSlot = (drop: SortableDrop | null) => {
    if (!slot || !sourceRow || !list || !local.tree) return;
    const rows = withDepth(local.tree.rows);
    const depth = drop?.depth ?? rows.find(row => landingRows.some(entry => entry.id === row.id && entry.element === sourceRow))?.depth ?? 0;
    const target = landingRows.find(entry => rows.find(row => row.id === entry.id)?.depth === depth)?.element ?? sourceRow;
    const box = target.getBoundingClientRect();
    const targetDepth = rows.find(row => landingRows.some(entry => entry.id === row.id && entry.element === target))?.depth ?? 0;
    const step = local.tree.indent;
    const inset = local.tree.inset(target);
    const indent = inset + (depth - targetDepth) * step;
    const parent = slot.parentElement;

    if (!parent) return;
    slot.style.marginInlineStart = `${box.left + indent - parent.getBoundingClientRect().left}px`;
    slot.style.width = `${box.width - indent}px`;
  };

  let stopListening: (() => void) | undefined;

  const preview = (drop: SortableDrop | null) => {
    if (drop?.parent === previewed?.parent && drop?.index === previewed?.index && drop?.depth === previewed?.depth) return;

    previewed = drop;

    placeSlot(drop);
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

  const track = (source: Draggable | null, position: { initial: { x: number }; current: { x: number; y: number } }) => {
    const tree = local.tree;

    if (!tree || !isSortable(source)) return;
    const atLift = !keyboard && source.manager?.dragOperation.shape?.initial.containsPoint({ x: position.initial.x, y: position.current.y });
    preview(resolve(tree, String(source.id), atLift ? source.initialIndex : source.index, { initial: position.initial.x, current: position.current.x }).drop);
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

  const clearPreview = (animate = false) => {
    closingSlot?.remove();
    closingSlot = null;
    const original = sourceRow;

    original?.classList.remove("sortable-source");
    sourceRow = null;
    stopTracking?.();
    stopTracking = undefined;
    const ending = slot;
    const restore = restoreSource;

    restoreSource = undefined;

    const remove = () => {
      // OptimisticSorting restores the proxy at dragend in the renderer's next task.
      setTimeout(() => {
        if (original && ProxiedElements.get(original) === ending) ProxiedElements.delete(original);
        restore?.();
        ending?.remove();
      });
    };

    if (animate && ending?.isConnected && ending.dataset.keyboard !== "true" && !reduced()) {
      closingSlot = ending;
      const styles = getComputedStyle(ending);
      const opacity = styles.opacity;
      const duration = Number.parseFloat(styles.getPropertyValue("--duration-crossfade"));
      const easing = styles.getPropertyValue("--easing-out").trim();

      for (const animation of ending.getAnimations()) animation.cancel();
      ending.dataset.ending = "true";
      const exit = ending.animate([{ opacity }, { opacity: 0 }], { duration, easing });

      void Promise.allSettled([exit.finished]).then(() => {
        remove();

        if (closingSlot === ending) closingSlot = null;
      });
    } else remove();
    slot = null;
    list?.removeAttribute("data-sortable-index");
  };

  onCleanup(() => { clearPreview(); stopRestoringFocus?.(); stopListening?.(); mark(null); });

  return <DragDropProvider sensors={defaults => defaults.map(sensor => sensor === PointerSensor ? pointerSensor() : sensor)} modifiers={[RestrictToElement.configure({ element: () => list ?? null })]} onDragStart={(event) => {
    const tree = local.tree;
    const source = event.operation.source;

    if (source?.element) {
      clearPress(source.element);

      for (const control of source.element.querySelectorAll("[data-pressed]")) clearPress(control);
    }

    previewed = null;
    clearPreview();

    if (source?.element instanceof HTMLElement) {
      landingRows = [...source.manager?.registry.draggables ?? []].flatMap(row => row.element instanceof HTMLElement && list?.contains(row.element) ? [{id: String(row.id), element: row.element}] : []);
      sourceRow = source.element;
      const box = sourceRow.getBoundingClientRect();
      sourceRow.classList.add("sortable-source");
      const keyboardLift = event.operation.activatorEvent instanceof KeyboardEvent;
      const styles = getComputedStyle(sourceRow);
      const duration = keyboardLift ? 0 : Number.parseFloat(styles.getPropertyValue("--duration-crossfade"));
      const easing = styles.getPropertyValue("--easing-out").trim();

      // Sortable owns sibling transforms; the real source must stay at its original position.
      for (const draggable of source.manager?.registry.draggables ?? []) {
        if (isSortable(draggable)) draggable.sortable.transition = { duration: draggable === source ? 0 : duration, easing };
      }

      slot = document.createElement("div");
      slot.className = "sortable-slot";
      slot.setAttribute("data-dnd-placeholder", "");
      slot.setAttribute("aria-hidden", "true");
      slot.style.height = `${box.height}px`;
      slot.dataset.keyboard = String(keyboardLift);
      sourceRow.insertAdjacentElement("afterend", slot);
      placeSlot(null);

      // WAAPI belongs to this lift: re-inserting the slot at another gap cannot restart its entrance.
      if (!keyboardLift && !reduced()) slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing });
      ProxiedElements.set(sourceRow, slot);

      const target = isSortable(source) ? source.sortable.target : undefined;
      const placeholder = slot;

      restoreSource = () => {
        if (isSortable(source) && source.sortable.target === placeholder) source.sortable.target = target;
      };

      stopTracking = effect(() => {
        if (!isSortable(source)) return;

        // Keeping the original hit target at lift prevents the new slot from selecting a neighbour.
        source.sortable.target = source.index === source.initialIndex ? target : placeholder;
        list?.setAttribute("data-sortable-index", String(source.index));

        track(source, event.operation.position);
        placeSlot(previewed);
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
  }} plugins={(defaults) => defaults.filter((plugin) => plugin !== Cursor && !(local.plain && plugin === Accessibility)).map((plugin) => plugin === Feedback ? Feedback.configure({ dropAnimation: null, keyboardTransition: null }) : plugin)} onDragMove={(event) => {
    const { source, position } = event.operation;

    // The library dispatches dragmove before it applies the move, so the destination is `to`, else the current position plus `by`.
    const x = event.to?.x ?? position.current.x + (event.by?.x ?? 0);
    const y = event.to?.y ?? position.current.y + (event.by?.y ?? 0);

    track(source, { initial: position.initial, current: { x, y } });

    if (!local.external || !source) return;
    mark(local.external.target(String(source.id), x, y));
  }} onDragEnd={(event) => {
    const source = event.operation.source;
    const outside = over;
    const pointerDrag = !(event.operation.activatorEvent instanceof KeyboardEvent);

    clearPreview(true);

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
        });
      });
    }

    const tree = local.tree;
    const point = event.operation.position.current;
    const box = list?.getBoundingClientRect();
    // RestrictToElement constrains the decoration, not the sensor's pointer distance.
    // Horizontal overrun remains a tree destination only while dnd-kit targets this list.
    const target = event.operation.target?.element;
    const horizontalOverrun = tree && !outside && target && list?.contains(target);
    const inside = !pointerDrag || (box && point.y >= box.top && point.y < box.bottom
      && ((point.x >= box.left && point.x < box.right) || horizontalOverrun));

    // The extra gap can leave OptimisticSorting's index on a neighbour after the pointer returns.
    // Use the library's lift shape to keep that return in the original slot, preserving horizontal depth.
    const index = isSortable(source) ? pointerDrag && event.operation.shape?.initial.containsPoint(tree ? { x: event.operation.position.initial.x, y: point.y } : point) ? source.initialIndex : source.index : null;

    const final = tree && inside && !event.canceled && isSortable(source)
      ? resolve(tree, String(source.id), index ?? source.index, { initial: event.operation.position.initial.x, current: event.operation.position.current.x })
      : null;

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

    if (!isSortable(source) || source.initialIndex === index) return;
    const order = [...local.ids];
    const [moved] = order.splice(source.initialIndex, 1);

    if (moved === undefined) return;
    order.splice(index ?? source.initialIndex, 0, moved);
    local.onOrderChange?.(order, String(source.id));
  }}><div {...rest} ref={list} data-plain={local.plain ? "" : undefined}>{local.children}</div><DragOverlay class="sortable-overlay" dropAnimation={null}>{null}</DragOverlay></DragDropProvider>;
};

type ItemProps = Pick<UseSortableInput, "id" | "index" | "disabled"> & {
  /** The handle is also a button: a pointer drag starts after 4 px, so a click stays a click, and Space and Enter stay the button's own. */
  pressable?: boolean;
  children: (parts: ReturnType<typeof useSortable>) => JSX.Element;
};

const Item = (props: ItemProps) => {
  const sortable = useSortable(mergeProps(props, { transition: { duration: 0 } }, props.pressable ? { sensors: [pointerSensor()] } : {}));

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

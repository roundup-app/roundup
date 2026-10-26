import { clearPress } from "./pressFeedback";
import { captureFocus } from "../keys/focus";
import "./sortable.css";
import { Accessibility, Cursor, DragDropManager, Feedback, PointerActivationConstraints, PointerSensor, type Draggable } from "@dnd-kit/dom";
import { RestrictToElement } from "@dnd-kit/dom/modifiers";
import { ProxiedElements } from "@dnd-kit/dom/utilities";
import { effect, batch } from "@dnd-kit/state";
import { DragDropProvider, DragOverlay, useDragDropManager } from "@dnd-kit/solid";
import { Sortable as DomSortable, defaultSortableTransition, isSortable } from "@dnd-kit/dom/sortable";
import { createEffect, on, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import type { ExternalTarget, ItemBinding, RootBinding, SortableDrop, SortableTree, TreeRow } from "./sortable";

/** A press that moves less than this is a click. */
const PRESS_DRAG_PX = 4;

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

/** The drag implementation for one list: the library manager and every handler the list needs, mounted when the first drag intent loads this module. */
export const mountDrag = <T extends ExternalTarget>(local: RootBinding<T>) => {
  let over: T | null = null;
  const listElement = () => local.list();
  let sourceRow: HTMLElement | null = null;
  let slot: HTMLDivElement | null = null;
  let stopTracking: (() => void) | undefined;
  let restoreSource: (() => void) | undefined;
  let closingSlot: HTMLDivElement | null = null;

  // Keyboard drags choose depth with ArrowLeft and ArrowRight; `slot` is the gap `depth` belongs to.
  let keyboard: { slot: number; depth: number } | null = null;
  let previewed: SortableDrop | null = null;
  let stopListening: (() => void) | undefined;

  const preview = (drop: SortableDrop | null) => {
    if (drop?.parent === previewed?.parent && drop?.index === previewed?.index && drop?.depth === previewed?.depth) return;

    previewed = drop;

    if (slot && drop && local.tree) slot.style.setProperty("--sortable-indent", `${drop.depth * local.tree.indent}px`);
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
    preview(resolve(tree, String(source.id), source.index, { initial: position.initial.x, current: position.current.x }).drop);
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

    if (animate && ending?.isConnected && ending.dataset.keyboard !== "true" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
    listElement()?.removeAttribute("data-sortable-index");
  };

  onCleanup(() => { clearPreview(); stopRestoringFocus?.(); stopListening?.(); mark(null); });

  let manager: DragDropManager | null = null;

  const Grab = () => {
    manager = useDragDropManager();

    return null;
  };

  // The overlay belongs to the provider's tree, which the rows are not inside: it mounts beside them, not around them.
  const host = document.createElement("div");

  host.style.display = "contents";
  document.body.append(host);

  const unmount = render(() => <DragDropProvider sensors={defaults => defaults.map(sensor => sensor === PointerSensor ? PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: PRESS_DRAG_PX })] }) : sensor)} modifiers={[RestrictToElement.configure({ element: () => listElement() ?? null })]} onDragStart={(event) => {
    const tree = local.tree;
    const source = event.operation.source;

    if (source?.element) {
      clearPress(source.element);

      for (const control of source.element.querySelectorAll("[data-pressed]")) clearPress(control);
    }

    previewed = null;
    clearPreview();

    if (source?.element instanceof HTMLElement) {
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
      // Until the first swap the slot stands over the row's own cell and its room trails the list, so a nudge that returns to it is no move (U490a).
      slot.style.marginBlock = `${-box.height}px ${box.height}px`;
      slot.dataset.keyboard = String(keyboardLift);
      sourceRow.insertAdjacentElement("afterend", slot);

      // WAAPI belongs to this lift: re-inserting the slot at another gap cannot restart its entrance.
      if (!keyboardLift && !matchMedia("(prefers-reduced-motion: reduce)").matches) slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing });
      ProxiedElements.set(sourceRow, slot);

      if (isSortable(source)) {
        const target = source.sortable.target;
        const placeholder = slot;

        source.sortable.target = placeholder;
        void source.manager?.actions.setDropTarget(source.id);
        restoreSource = () => {
          if (source.sortable.target === placeholder) source.sortable.target = target;
        };
      }

      stopTracking = effect(() => {
        if (!isSortable(source)) return;

        listElement()?.setAttribute("data-sortable-index", String(source.index));

        if (source.index !== source.initialIndex) slot?.style.removeProperty("margin-block");

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
  }} plugins={(defaults) => defaults.filter((plugin) => plugin !== Cursor && !(local.plain && plugin === Accessibility)).map((plugin) => plugin === Feedback ? Feedback.configure({ dropAnimation: null, keyboardTransition: null }) : plugin)} onDragMove={(event) => {
    const { source, position } = event.operation;

    // The library dispatches dragmove before it applies the move, so the destination is `to`, else the current position plus `by`.
    const x = event.to?.x ?? position.current.x + (event.by?.x ?? 0);
    const y = event.to?.y ?? position.current.y + (event.by?.y ?? 0);

    track(source, { initial: position.initial, current: { x } });

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
    const box = listElement()?.getBoundingClientRect();
    const inside = !pointerDrag || (box && point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom);

    // The extra gap can leave OptimisticSorting's index on a neighbour after the pointer returns.
    // Use the library's lift shape to keep that return in the original slot, preserving horizontal depth.
    const index = isSortable(source) ? pointerDrag && event.operation.shape?.initial.containsPoint(point) ? source.initialIndex : source.index : null;

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
    local.onOrderChange?.(order);
  }}><Grab /><DragOverlay class="sortable-overlay" dropAnimation={null}>{null}</DragOverlay></DragDropProvider>, host);

  onCleanup(() => { unmount(); host.remove(); });

  const sensorsOf = () => [PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: PRESS_DRAG_PX })] })];

  /** The library's sortable for a row the entry rendered, kept in step with the row's id, index and elements as `useSortable` does. */
  const attach = (item: ItemBinding) => {
    const sortable = new DomSortable({ id: item.id(), index: item.index(), register: false, transition: { ...defaultSortableTransition, duration: 0 }, ...(item.pressable ? { sensors: sensorsOf() } : {}) }, manager ?? undefined);

    createEffect(() => {
      sortable.manager = manager ?? undefined;
      const unregister = sortable.register();

      onCleanup(() => unregister?.());
    });

    createEffect(() => {
      const element = item.element();
      const handle = item.handle();

      if (element) sortable.element = element;

      if (handle) sortable.handle = handle;
      sortable.id = item.id();
      sortable.disabled = item.disabled() ?? false;
    });

    createEffect(on(item.index, () => {
      batch(() => { sortable.index = item.index(); });

      if (sortable.manager?.dragOperation.status.idle && sortable.transition?.idle) sortable.refreshShape();
    }));

    onCleanup(effect(() => item.setDragging(sortable.isDragging)));
  };

  return { attach };
};

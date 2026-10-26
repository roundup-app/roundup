import { createContext, createEffect, createSignal, getOwner, mergeProps, onCleanup, onMount, runWithOwner, splitProps, useContext, type Accessor, type JSX } from "solid-js";
import type { UseSortableInput } from "@dnd-kit/solid/sortable";

/** A drop target outside the list; `element` carries `data-drop` while the pointer is over it. */
export type ExternalTarget = { element: HTMLElement; /** Carried instead of the list's `attribute` while the pointer is over this target. */ attribute?: string };

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
export type SortableDrop = { parent: string | null; index: number; depth: number };

/** A committed drop: `index` counts the parent's children without the dragged row. */
export type SortableMove = { id: string; parent: string | null; index: number };

/** Rows with a parent: a drop reports `onMove` instead of the flat order. */
export type SortableTree = {
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

/** What the drag implementation reads of a list. */
export type RootBinding<T extends ExternalTarget> = Pick<RootProps<T>, "ids" | "onOrderChange" | "tree" | "external" | "plain" | "onDrag"> & { list: () => HTMLDivElement | undefined };

/** What the drag implementation reads of a row, and how it reports back. */
export type ItemBinding = {
  id: () => UseSortableInput["id"];
  index: () => number;
  disabled: () => UseSortableInput["disabled"];
  pressable: boolean | undefined;
  element: () => HTMLElement | undefined;
  handle: () => HTMLElement | undefined;
  setDragging: (dragging: boolean) => void;
};

type Drag = { attach: (item: ItemBinding) => void };

type Gesture = { events: Event[]; stop: () => void };

type RootContext = { drag: Accessor<Drag | undefined>; items: Set<ItemBinding> };

const Context = createContext<RootContext>();

// R3800: @dnd-kit stays out of the entry until the first pointer or keyboard drag intent loads it.
let loading: Promise<typeof import("./sortableDnd")> | undefined;

const loadDrag = () => (loading ??= import("./sortableDnd").catch((error: unknown) => {
  loading = undefined;

  throw error;
}));

const POINTER_FIELDS = ["pointerId", "pointerType", "isPrimary", "button", "buttons", "clientX", "clientY", "screenX", "screenY", "pressure", "width", "height", "ctrlKey", "shiftKey", "altKey", "metaKey"] as const;
const KEY_FIELDS = ["key", "code", "repeat", "ctrlKey", "shiftKey", "altKey", "metaKey"] as const;

/** A copy of an event the list took before the library existed. It reaches only the element or document the library listens on, and still names the element the user pressed, which the library's activation rules read. */
const copyOf = (event: Event): Event => {
  const fields = event instanceof PointerEvent ? POINTER_FIELDS : KEY_FIELDS;
  const init: Record<string, unknown> = { bubbles: false, cancelable: true, composed: true, view: window };

  for (const field of fields) init[field] = (event as unknown as Record<string, unknown>)[field];

  const copy = event instanceof PointerEvent ? new PointerEvent(event.type, init) : new KeyboardEvent(event.type, init);

  Object.defineProperty(copy, "target", { value: event.target });

  return copy;
};

/** The events of the gesture after its first, kept until the library can take them in their order. */
const record = (first: Event): Gesture => {
  const types = first instanceof PointerEvent ? ["pointermove", "pointerup", "pointercancel"] : ["keydown", "keyup"];
  const events: Event[] = [];
  const keep = (event: Event) => { events.push(event); };

  for (const type of types) document.addEventListener(type, keep, { capture: true });

  return { events, stop: () => { for (const type of types) document.removeEventListener(type, keep, { capture: true }); } };
};

/** The handle `event` starts a drag from: a primary press on a handle, or Space or Enter on the handle of a row that is not pressable. */
const startsDrag = (items: ReadonlySet<ItemBinding>, event: Event): HTMLElement | null => {
  const target = event.target;

  if (!(target instanceof Node)) return null;

  for (const item of items) {
    const grip = item.handle() ?? item.element();

    if (item.disabled() || !grip?.contains(target)) continue;

    if (event instanceof PointerEvent) return event.isPrimary && event.button === 0 ? grip : null;

    return event instanceof KeyboardEvent && !item.pressable && grip === target && (event.code === "Space" || event.code === "Enter") ? grip : null;
  }

  return null;
};

const Root = <T extends ExternalTarget>(props: RootProps<T>) => {
  const [local, rest] = splitProps(props, ["ids", "onOrderChange", "tree", "external", "plain", "onDrag", "children"]);
  const [drag, setDrag] = createSignal<Drag>();
  const context: RootContext = { drag, items: new Set() };
  const owner = getOwner();
  let list: HTMLDivElement | undefined;
  let intended = false;
  let gone = false;

  onCleanup(() => { gone = true; });

  const onIntent = (first: Event) => {
    const grip = intended ? null : startsDrag(context.items, first);

    if (!grip) return;

    intended = true;

    if (first instanceof KeyboardEvent) first.preventDefault();
    const gesture = record(first);

    void loadDrag().then(({ mountDrag }) => {
      gesture.stop();

      if (gone) return;
      setDrag(runWithOwner(owner, () => mountDrag(mergeProps(local, { list: () => list }))) ?? undefined);

      // The first intent happened before the library could hear it: the same events reach it now, in their order.
      grip.dispatchEvent(copyOf(first));

      for (const event of gesture.events) document.dispatchEvent(copyOf(event));
    }, () => { gesture.stop(); intended = false; });
  };

  onMount(() => {
    list?.addEventListener("pointerdown", onIntent, { capture: true });
    list?.addEventListener("keydown", onIntent, { capture: true });
    onCleanup(() => {
      list?.removeEventListener("pointerdown", onIntent, { capture: true });
      list?.removeEventListener("keydown", onIntent, { capture: true });
    });
  });

  return <Context.Provider value={context}><div {...rest} ref={list} data-plain={local.plain ? "" : undefined}>{local.children}</div></Context.Provider>;
};

/** What a row gets to render with. */
export type SortableParts = {
  ref: (element: HTMLElement | undefined) => void;
  handleRef: (element: HTMLElement | undefined) => void;
  isDragging: () => boolean;
};

type ItemProps = Pick<UseSortableInput, "id" | "index" | "disabled"> & {
  /** The handle is also a button: a pointer drag starts after 4 px, so a click stays a click, and Space and Enter stay the button's own. */
  pressable?: boolean;
  children: (parts: SortableParts) => JSX.Element;
};

const Item = (props: ItemProps) => {
  const context = useContext(Context);

  if (!context) throw new Error("Sortable.Item outside Sortable.Root");

  const [element, setElement] = createSignal<HTMLElement>();
  const [handle, setHandle] = createSignal<HTMLElement>();
  const [dragging, setDragging] = createSignal(false);
  const binding: ItemBinding = { id: () => props.id, index: () => props.index, disabled: () => props.disabled, pressable: props.pressable, element, handle, setDragging };

  context.items.add(binding);
  onCleanup(() => context.items.delete(binding));

  createEffect(() => context.drag()?.attach(binding));

  return props.children({ ref: setElement, handleRef: setHandle, isDragging: dragging });
};

export const Sortable = { Root, Item };

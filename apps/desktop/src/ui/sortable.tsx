import { createContext, createEffect, createSignal, getOwner, mergeProps, onCleanup, onMount, runWithOwner, splitProps, useContext, type Accessor, type JSX } from "solid-js";
import "./sortable.css";
import type { UseSortableInput } from "@dnd-kit/solid/sortable";
import type { ExternalTarget, ItemBinding, RootProps } from "./sortableTypes";

export type { SortableMove, TreeRow } from "./sortableTypes";

type Drag = { attach: (item: ItemBinding) => void };

type Gesture = { events: Event[]; stop: () => void };

type RootContext = { drag: Accessor<Drag | undefined>; items: Set<ItemBinding>; instructions: string | undefined };

const Context = createContext<RootContext>();

// The library's own screen reader text (Accessibility plugin defaults), rendered at mount so rows read as draggable before its chunk loads.
const INSTRUCTIONS = "To pick up a draggable item, press the space bar. While dragging, use the arrow keys to move the item in a given direction. Press space again to drop the item in its new position, or press escape to cancel.";
let instructionsCount = 0;

// R3800: @dnd-kit stays out of the entry until the first pointer or keyboard drag intent loads it.
let loading: Promise<typeof import("./sortableDnd")> | undefined;

const loadDrag = async () => {
  try {
    return await (loading ??= import("./sortableDnd"));
  } catch (error) {
    loading = undefined;

    throw error;
  }
};

const copyPointer = (event: PointerEvent): PointerEvent => {
  const { pointerId, pointerType, isPrimary, button, buttons, clientX, clientY, screenX, screenY, pressure, width, height, ctrlKey, shiftKey, altKey, metaKey } = event;

  return new PointerEvent(event.type, { bubbles: false, cancelable: true, composed: true, view: window, pointerId, pointerType, isPrimary, button, buttons, clientX, clientY, screenX, screenY, pressure, width, height, ctrlKey, shiftKey, altKey, metaKey });
};

const copyKey = (event: KeyboardEvent): KeyboardEvent => {
  const { key, code, repeat, ctrlKey, shiftKey, altKey, metaKey } = event;

  return new KeyboardEvent(event.type, { bubbles: false, cancelable: true, composed: true, view: window, key, code, repeat, ctrlKey, shiftKey, altKey, metaKey });
};

/** A copy of an event the list took before the library existed. It reaches only the element or document the library listens on, and still names the element the user pressed, which the library's activation rules read. */
const copyOf = (event: Event): Event => {
  if (!(event instanceof PointerEvent) && !(event instanceof KeyboardEvent)) return event;

  const copy = event instanceof PointerEvent ? copyPointer(event) : copyKey(event);

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
  const context: RootContext = { drag, items: new Set(), instructions: local.plain ? undefined : `dnd-kit-description-entry-${instructionsCount++}` };
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

  return <Context.Provider value={context}><div {...rest} ref={list} data-plain={local.plain ? "" : undefined}>{context.instructions ? <div id={context.instructions} style={{ display: "none" }}>{INSTRUCTIONS}</div> : null}{local.children}</div></Context.Provider>;
};

/** What a row gets to render with. */
type SortableParts = {
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

  // The attributes the library's Accessibility plugin would add; it leaves a present attribute alone.
  createEffect(() => {
    const grip = handle() ?? element();

    if (!grip || !context.instructions) return;
    grip.setAttribute("aria-roledescription", "draggable");
    grip.setAttribute("aria-describedby", context.instructions);
  });

  return props.children({ ref: setElement, handleRef: setHandle, isDragging: dragging });
};

export const Sortable = { Root, Item };

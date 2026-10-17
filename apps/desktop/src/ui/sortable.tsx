import { Cursor, Feedback } from "@dnd-kit/dom";
import { effect } from "@dnd-kit/state";
import { DragDropProvider } from "@dnd-kit/solid";
import { isSortable } from "@dnd-kit/dom/sortable";
import { useSortable, type UseSortableInput } from "@dnd-kit/solid/sortable";
import { onCleanup, splitProps, type JSX } from "solid-js";

type RootProps = JSX.HTMLAttributes<HTMLDivElement> & {
  ids: readonly string[];
  onOrderChange: (ids: string[]) => void;
  /** U362: a drop target outside the list. `target` is the hit test at a pointer position; a release over one calls `onDropOutside` instead of `onOrderChange`. */
  external?: {
    target: (id: string, x: number, y: number) => HTMLElement | null;
    onDropOutside: (id: string, target: HTMLElement) => void;
  };
};

const Root = (props: RootProps) => {
  const [local, rest] = splitProps(props, ["ids", "onOrderChange", "external", "children"]);
  let marked: HTMLElement | undefined;
  let stopRestoringFocus: (() => void) | undefined;

  const mark = (target: HTMLElement | null) => {
    if (marked === target) return;
    marked?.removeAttribute("data-drop");
    marked = target ?? undefined;
    marked?.setAttribute("data-drop", "");
  };

  // The operation's own position lags a move event, so the pointer is read from the native event.
  let pointer: { x: number; y: number } | undefined;

  const hit = (id: string | number | undefined) => local.external && pointer && id !== undefined ? local.external.target(String(id), pointer.x, pointer.y) : null;

  onCleanup(() => { stopRestoringFocus?.(); mark(null); });

  return <DragDropProvider plugins={(defaults) => defaults.filter((plugin) => plugin !== Cursor).map((plugin) => plugin === Feedback ? Feedback.configure({ dropAnimation: null, keyboardTransition: null }) : plugin)} onDragStart={() => { pointer = undefined; }} onDragMove={(event) => {
    const native = event.nativeEvent;

    if (native instanceof PointerEvent) pointer = { x: native.clientX, y: native.clientY };
    mark(hit(event.operation.source?.id));
  }} onDragEnd={(event) => {
    const outside = event.canceled ? null : hit(event.operation.source?.id);

    mark(null);
    const source = event.operation.source;

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

    if (event.canceled) return;

    if (outside && source) {
      local.external!.onDropOutside(String(source.id), outside);

      return;
    }

    if (!isSortable(source) || source.initialIndex === source.index) return;
    const order = [...local.ids];
    const [moved] = order.splice(source.initialIndex, 1);

    if (moved === undefined) return;
    order.splice(source.index, 0, moved);
    local.onOrderChange(order);
  }}><div {...rest}>{local.children}</div></DragDropProvider>;
};

type ItemProps = Pick<UseSortableInput, "id" | "index" | "disabled"> & {
  children: (parts: ReturnType<typeof useSortable>) => JSX.Element;
};

const Item = (props: ItemProps) => {
  const sortable = useSortable(props);

  return props.children(sortable);
};

export const Sortable = { Root, Item };

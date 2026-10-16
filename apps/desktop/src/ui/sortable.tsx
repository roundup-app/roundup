import { Cursor, Feedback } from "@dnd-kit/dom";
import { effect } from "@dnd-kit/state";
import { DragDropProvider } from "@dnd-kit/solid";
import { isSortable } from "@dnd-kit/dom/sortable";
import { useSortable, type UseSortableInput } from "@dnd-kit/solid/sortable";
import { onCleanup, splitProps, type JSX } from "solid-js";

type RootProps = JSX.HTMLAttributes<HTMLDivElement> & {
  ids: readonly string[];
  onOrderChange: (ids: string[]) => void;
};

const Root = (props: RootProps) => {
  const [local, rest] = splitProps(props, ["ids", "onOrderChange", "children"]);
  let stopRestoringFocus: (() => void) | undefined;

  onCleanup(() => stopRestoringFocus?.());

  return <DragDropProvider plugins={(defaults) => defaults.filter((plugin) => plugin !== Cursor).map((plugin) => plugin === Feedback ? Feedback.configure({ dropAnimation: null, keyboardTransition: null }) : plugin)} onDragEnd={(event) => {
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

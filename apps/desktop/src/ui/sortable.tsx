import { DragDropProvider } from "@dnd-kit/solid";
import { isSortable, useSortable, type UseSortableInput } from "@dnd-kit/solid/sortable";
import { splitProps, type JSX } from "solid-js";

type RootProps = JSX.HTMLAttributes<HTMLDivElement> & {
  ids: readonly string[];
  onOrderChange: (ids: string[]) => void;
};

const Root = (props: RootProps) => {
  const [local, rest] = splitProps(props, ["ids", "onOrderChange", "children"]);

  return <DragDropProvider onDragEnd={(event) => {
    const source = event.operation.source;

    if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return;
    const order = [...local.ids];
    const [moved] = order.splice(source.initialIndex, 1);

    if (moved === undefined) return;
    order.splice(source.index, 0, moved);
    local.onOrderChange(order);
  }}><div {...rest}>{local.children}</div></DragDropProvider>;
};

type ItemProps = Pick<UseSortableInput, "id" | "index" | "group" | "disabled"> & {
  children: (parts: ReturnType<typeof useSortable>) => JSX.Element;
};

const Item = (props: ItemProps) => {
  const sortable = useSortable(props);

  return props.children(sortable);
};

export const Sortable = { Root, Item };

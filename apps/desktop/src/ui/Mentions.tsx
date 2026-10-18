import { Listbox as ArkListbox, createListCollection } from "@ark-ui/solid/listbox";
import { createContext, createMemo, For, Show, splitProps, useContext, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Popover } from "./Popover";

type Mention = { value: string; label: string };

const OpenContext = createContext<() => boolean>(() => false);

/** A suggestion list floating under a multi-line field: the caller filters `items` and the list shows while any remain, anchored to the field so it moves nothing around it. Ark owns the highlight and `↑` `↓` (no wrap), and a click on a row calls `onSelect`. */
const Root = (props: {
  items: readonly Mention[];
  highlightedValue: string | null;
  onHighlightChange: (value: string | null) => void;
  onSelect: (value: string) => void;
  children: JSX.Element;
}) => {
  const collection = createMemo(() => createListCollection({ items: [...props.items], itemToValue: (item) => item.value, itemToString: (item) => item.label }));

  const open = () => props.items.length > 0;

  return <ArkListbox.Root collection={collection()} value={[]} highlightedValue={props.highlightedValue ?? undefined} typeahead={false}
    onHighlightChange={(details) => props.onHighlightChange(details.highlightedValue)}
    onValueChange={(details) => {
      const [value] = details.value;

      if (value !== undefined) props.onSelect(value);
    }}>
    <OpenContext.Provider value={open}>
      <Popover.Root open={open()} positioning={{ placement: "bottom-start", sameWidth: true, strategy: "fixed" }}>
        {props.children}
      </Popover.Root>
    </OpenContext.Provider>
  </ArkListbox.Root>;
};

/** The field the list belongs to. While the list is open, Ark takes `↑` `↓`; every other key, and every key while closed, stays the field's through `onKey`. */
const Field = (props: Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "onKeyDown"> & { onKey: (event: KeyboardEvent) => void }) => {
  const [local, rest] = splitProps(props, ["onKey"]);
  const open = useContext(OpenContext);

  return <Popover.Anchor><ArkListbox.Input asChild={(input) => <textarea {...input()} {...rest}
    aria-controls={open() ? input()["aria-controls"] : undefined}
    aria-activedescendant={open() ? input()["aria-activedescendant"] : undefined}
    onKeyDown={(event) => {
      local.onKey(event);

      if (!open() || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;

      const handler = input().onKeyDown;

      if (handler === undefined) return;

      if (0 in handler) handler[0](handler[1], event);
      else handler(event);
    }} />} /></Popover.Anchor>;
};

const List = (props: { label: string; items: readonly Mention[] }) => {
  const open = useContext(OpenContext);

  return <Show when={open()}>
    <Portal>
      <Popover.Positioner>
        <ArkListbox.Content class="app-listbox app-mentions" aria-label={props.label}>
          <For each={props.items}>{(item) => <ArkListbox.Item item={item} class="app-listbox-item"><ArkListbox.ItemText>{item.label}</ArkListbox.ItemText></ArkListbox.Item>}</For>
        </ArkListbox.Content>
      </Popover.Positioner>
    </Portal>
  </Show>;
};

export const Mentions = { Root, Field, List };

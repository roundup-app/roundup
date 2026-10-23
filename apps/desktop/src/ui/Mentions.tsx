import { Listbox as ArkListbox, createListCollection } from "@ark-ui/solid/listbox";
import { createEffect, createMemo, createSignal, on, For, Show, splitProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Popover } from "./Popover";

type Mention = { value: string; label: string };

/** A floating suggestion list anchored to a multi-line field: the caller filters `items`; Ark owns the highlight and `↑` `↓` (no wrap), and a click on a row calls `onSelect`. */
const Root = (props: {
  items: readonly Mention[];
  highlightedValue: string | null;
  onHighlightChange: (value: string | null) => void;
  onSelect: (value: string) => void;
  children: JSX.Element;
  onDismiss?: () => void;
}) => {
  const collection = createMemo(() => createListCollection({ items: [...props.items], itemToValue: (item) => item.value, itemToString: (item) => item.label }));

  const [dismissed, setDismissed] = createSignal(false);

  createEffect(on(() => props.items, () => setDismissed(false)));

  return <Popover.Root open={props.items.length > 0 && !dismissed()} onOpenChange={({ open }) => { if (!open) { setDismissed(true); props.onDismiss?.(); } }} closeOnEscape positioning={{ placement: "bottom-start", gutter: 4, strategy: "fixed" }}>
    <ArkListbox.Root collection={collection()} value={[]} highlightedValue={props.highlightedValue ?? undefined} typeahead={false}
      onHighlightChange={(details) => props.onHighlightChange(details.highlightedValue)}
      onValueChange={(details) => {
        const [value] = details.value;

        if (value !== undefined) props.onSelect(value);
      }}>
      {props.children}
    </ArkListbox.Root>
  </Popover.Root>;
};

/** The field the list belongs to. While `open`, Ark takes `↑` `↓`; every other key, and every key while closed, stays the field's through `onKey`. */
const Field = (props: Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "onKeyDown"> & { open: boolean; onKey: (event: KeyboardEvent) => void }) => {
  const [local, rest] = splitProps(props, ["open", "onKey"]);

  return <Popover.Anchor><ArkListbox.Input asChild={(input) => <textarea {...input()} {...rest}
    aria-controls={local.open ? input()["aria-controls"] : undefined}
    aria-activedescendant={local.open ? input()["aria-activedescendant"] : undefined}
    onKeyDown={(event) => {
      local.onKey(event);

      if (!local.open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;

      const handler = input().onKeyDown;

      if (handler === undefined) return;

      if (0 in handler) handler[0](handler[1], event);
      else handler(event);
    }} />} /></Popover.Anchor>;
};

const List = (props: { label: string; items: readonly Mention[] }) => (
  <Show when={props.items.length > 0}><Portal><Popover.Positioner><Popover.Content class="app-mentions-panel">
    <ArkListbox.Content class="app-listbox app-mentions" aria-label={props.label}>
      <For each={props.items}>{(item) => <ArkListbox.Item item={item} class="app-listbox-item"><ArkListbox.ItemText>{item.label}</ArkListbox.ItemText></ArkListbox.Item>}</For>
    </ArkListbox.Content>
  </Popover.Content></Popover.Positioner></Portal></Show>
);

export const Mentions = { Root, Field, List };

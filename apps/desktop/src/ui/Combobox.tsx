import "./Combobox.css";
import { Combobox as ArkCombobox, createListCollection } from "@ark-ui/solid/combobox";
import { createMemo, For, type JSX } from "solid-js";

type ComboboxItem = { value: string; label: string };

/** An always-open, filter-as-you-type list. The caller filters `items`; Ark owns the field, the highlight and `↑` `↓` (no wrap); a resting or moving pointer never moves the highlight. `onSelect` hears the highlighted value on `⏎`. */
const Root = (props: {
  items: readonly ComboboxItem[];
  highlightedValue: string | null;
  onHighlightChange: (value: string | null) => void;
  onInput: (text: string) => void;
  onSelect: (value: string) => void;
  label: string;
  placeholder: string;
  empty: string;
  group?: (item: ComboboxItem) => string | undefined;
  row: (item: ComboboxItem) => JSX.Element;
}) => {
  const collection = createMemo(() => createListCollection({ items: [...props.items], itemToValue: (item) => item.value, itemToString: (item) => item.label, groupBy: (item) => props.group?.(item) ?? "" }));

  // Ark highlights the row under the pointer; the highlight follows typing and the arrows alone, so a pointer event's own highlight change is dropped.
  let pointerEvent = false;

  const notePointer = (): void => {
    pointerEvent = true;
    setTimeout(() => { pointerEvent = false; });
  };

  return <ArkCombobox.Root class="app-combobox" collection={collection()} open lazyMount={false} inputBehavior="none" selectionBehavior="clear" loopFocus={false} autoFocus
    value={[]} highlightedValue={props.highlightedValue ?? undefined}
    onHighlightChange={(details) => { if (!pointerEvent) props.onHighlightChange(details.highlightedValue); }}
    onInputValueChange={(details) => props.onInput(details.inputValue)}
    onValueChange={(details) => {
      const [value] = details.value;

      if (value !== undefined) props.onSelect(value);
    }}>
    <ArkCombobox.Label class="app-combobox-label">{props.label}</ArkCombobox.Label>
    <ArkCombobox.Control><ArkCombobox.Input class="app-combobox-input" placeholder={props.placeholder} autofocus /></ArkCombobox.Control>
    <ArkCombobox.Content class="app-combobox-list" on:pointermove={{ handleEvent: notePointer, capture: true }} on:pointerleave={{ handleEvent: notePointer, capture: true }}>
      <For each={collection().group()} fallback={<p class="app-combobox-empty">{props.empty}</p>}>
        {([group, items]) => group ? <ArkCombobox.ItemGroup>
          <ArkCombobox.ItemGroupLabel class="app-combobox-group-label">{group}</ArkCombobox.ItemGroupLabel>
          <For each={items}>{(item) => <ArkCombobox.Item item={item} class="app-combobox-item">{props.row(item)}</ArkCombobox.Item>}</For>
        </ArkCombobox.ItemGroup> : <For each={items}>{(item) => <ArkCombobox.Item item={item} class="app-combobox-item">{props.row(item)}</ArkCombobox.Item>}</For>}
      </For>
    </ArkCombobox.Content>
  </ArkCombobox.Root>;
};

export const Combobox = { Root };

import "./Select.css";
import { Select as ArkSelect, createListCollection } from "@ark-ui/solid/select";
import { createMemo, createSignal, For, onCleanup, type JSX } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { Portal } from "solid-js/web";

export type SelectChoice = { value: string; label: string };

/** A labelled single-choice list over Ark's Select; Escape in an open list closes only that list. */
export const Select = (props: {
  label: string;
  choices: SelectChoice[];
  value: string;
  onValueChange: (value: string) => void;
}): JSX.Element => {
  const collection = createMemo(() => createListCollection({ items: props.choices, itemToValue: (choice) => choice.value, itemToString: (choice) => choice.label }));
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [list, setList] = createSignal<HTMLDivElement>();
  let open = false;
  const closing = new WeakSet<Event>();

  // Ark closes the list before an Escape reaches the form, so mark the Escape that found it open first.
  const mark = (event: KeyboardEvent) => {
    const target = event.target;

    if (event.key === "Escape" && open && target instanceof Node && (root()?.contains(target) || list()?.contains(target))) closing.add(event);
  };

  document.addEventListener("keydown", mark, true);
  onCleanup(() => document.removeEventListener("keydown", mark, true));

  return <div class="app-select" ref={setRoot} onKeyDown={(event) => { if (closing.has(event)) event.stopPropagation(); }}>
    <ArkSelect.Root
      collection={collection()}
      value={[props.value]}
      onValueChange={(details) => props.onValueChange(details.value[0] ?? props.value)}
      onOpenChange={(details) => { open = details.open; }}
      positioning={{ strategy: "fixed", sameWidth: true }}
      lazyMount
      unmountOnExit
    >
      <ArkSelect.Label class="app-select-label">{props.label}</ArkSelect.Label>
      <ArkSelect.Control>
        <ArkSelect.Trigger class="app-select-trigger" aria-label={props.label}>
          <ArkSelect.ValueText />
          <ChevronDown aria-hidden="true" class="app-select-mark" size={16} />
        </ArkSelect.Trigger>
      </ArkSelect.Control>
      <Portal>
        <ArkSelect.Positioner>
          <ArkSelect.Content class="app-select-list" ref={setList}>
            <For each={props.choices}>{(choice) => <ArkSelect.Item item={choice} class="app-select-item">
              <ArkSelect.ItemText>{choice.label}</ArkSelect.ItemText>
            </ArkSelect.Item>}</For>
          </ArkSelect.Content>
        </ArkSelect.Positioner>
      </Portal>
      <ArkSelect.HiddenSelect />
    </ArkSelect.Root>
  </div>;
};

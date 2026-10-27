import { createListCollection, useListSelection } from "@ark-ui/solid/collection";
import { createSignal, onMount, onCleanup } from "solid-js";

// Shortcut guards and the row handler consult the same library search for one press.
const searches = new WeakMap<Element, (event: KeyboardEvent) => string | null>();

export const rowTypeahead = (event: KeyboardEvent) => event.target instanceof Element
  && searches.get(event.target)?.(event) != null;

/** Ark owns selection, ranges, navigation and the buffered name search of existing row buttons. */
export const createRowCollection = (items: () => { value: string; label: string }[]) => {
  const [mounted, setMounted] = createSignal(false);
  onMount(() => setMounted(true));
  const collection = () => createListCollection({ items: mounted() ? items() : [], itemToValue: item => item.value, itemToString: item => item.label });
  const selection = useListSelection(() => ({ collection: collection(), selectionMode: "multiple" }));
  const state = { keysSoFar: "", timer: -1 };
  const results = new WeakMap<KeyboardEvent, string | null>();

  const search = (event: KeyboardEvent) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || event.key === " ") return null;

    if (results.has(event)) return results.get(event)!;
    const row = event.target instanceof HTMLElement ? event.target : null;

    // Ark cycles past the current row for a repeated letter. Its sole match still owns typing.
    const value = collection().search(event.key, { state, currentValue: row?.dataset.collectionValue ?? null })
      ?? collection().search("", { state, currentValue: null });

    results.set(event, value);

    return value;
  };

  const reset = () => { window.clearTimeout(state.timer); state.keysSoFar = ""; };

  onCleanup(reset);

  return {
    collection, selection, search, reset,
    register: (row: HTMLButtonElement, value: string) => {
      row.dataset.collectionValue = value;
      searches.set(row, search);
    },
  };
};

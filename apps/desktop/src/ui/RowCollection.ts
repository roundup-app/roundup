import { createListCollection, useListSelection } from "@ark-ui/solid/collection";
import { createSignal, onCleanup } from "solid-js";

/** Ark owns selection and typeahead; callers supply their eligible rows in reading order. */
export const createRowCollection = () => {
  const [collection, setCollection] = createSignal(createListCollection<{ value: string; label: string }>({ items: [] }));
  const selection = useListSelection(() => ({ collection: collection(), selectionMode: "multiple" }));
  const search = { keysSoFar: "", timer: -1 };
  onCleanup(() => window.clearTimeout(search.timer));

  return {
    collection,
    selection,
    refresh: (items: { value: string; label: string }[]) => setCollection(createListCollection({ items })),
    search: (key: string, currentValue: string) => collection().search(key, { state: search, currentValue }),
  };
};

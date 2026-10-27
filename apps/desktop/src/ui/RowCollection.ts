import { createListCollection, useListSelection } from "@ark-ui/solid/collection";
import { createComputed, createSignal, onMount, onCleanup } from "solid-js";

const keys = new WeakMap<Element, (event: KeyboardEvent) => boolean>();

/** Dispatch the focused collection's keys before a modal suppresses unbound input. */
export const rowKey = (event: KeyboardEvent) => event.target instanceof Element
  && keys.get(event.target)?.(event) === true;

// Shortcut guards and the row handler consult the same library search for one press.
const searches = new WeakMap<Element, (event: KeyboardEvent) => string | null>();

export const rowTypeahead = (event: KeyboardEvent) => event.target instanceof Element
  && searches.get(event.target)?.(event) != null;

/** Ark owns selection, ranges, navigation and the buffered name search of existing row buttons. */
export const createRowCollection = (items: () => { value: string; label: string }[], interaction?: { onFocus: (value: string) => void; onActivate: (value: string) => void }) => {
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

  const rows = new Map<string, HTMLElement>();

  let anchor: string | undefined;
  let pending: { value: string } | null = null;

  createComputed(() => {
    const visible = collection();

    if (pending && !visible.has(pending.value)) pending = null;
  });

  const complete = (request: { value: string }) => {
    const row = rows.get(request.value);

    if (pending !== request || !row?.isConnected || !collection().has(request.value)) return;
    pending = null;
    row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: "nearest" });
  };

  const focusRow = (value: string | null | undefined) => {
    const request = pending = value == null ? null : { value };

    if (!request) return;
    interaction?.onFocus(value!);
    complete(request);
  };

  const targetRow = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>("[data-collection-value]") : null;

  const click = (event: MouseEvent) => {
    const row = targetRow(event);
    const value = row?.dataset.collectionValue;

    if (!interaction || value === undefined || event.ctrlKey || !event.metaKey && !event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    const visible = collection();

    if (!visible.has(value)) return;

    if (event.shiftKey) selection.setSelectedValues(anchor === undefined || !visible.has(anchor) ? [value] : visible.getValueRange(anchor, value));
    else { selection.toggle(value); anchor = value; }

    focusRow(value);
  };

  const key = (event: KeyboardEvent) => {
    const value = targetRow(event)?.dataset.collectionValue;

    if (!interaction || value === undefined || event.ctrlKey || event.altKey || event.isComposing) return false;
    const visible = collection();

    if (event.metaKey && event.key.toLowerCase() === "a") {
      event.preventDefault(); event.stopPropagation();
      selection.setSelectedValues(visible.getValues());

      return true;
    }

    if (event.metaKey) return false;

    const next = event.key === "Home" ? visible.firstValue
      : event.key === "End" ? visible.lastValue
      : event.key === "ArrowUp" ? visible.getPreviousValue(value)
      : event.key === "ArrowDown" ? visible.getNextValue(value) : undefined;

    if (next !== undefined) {
      event.preventDefault(); event.stopPropagation(); focusRow(next);

      return true;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation();

      if (visible.has(value)) interaction?.onActivate(value);

      return true;
    }

    const match = search(event);

    if (match !== null) {
      event.preventDefault(); event.stopPropagation();
      selection.replace(match); focusRow(match);

      return true;
    }

    return false;
  };

  const reset = () => { window.clearTimeout(state.timer); state.keysSoFar = ""; };

  onCleanup(() => { pending = null; reset(); });

  return {
    collection, selection, search, reset, click,
    register: (row: HTMLElement, value: string) => {
      row.dataset.collectionValue = value;
      searches.set(row, search);

      if (interaction) {
        rows.set(value, row); keys.set(row, key);
        const request = pending;

        if (request?.value === value) {
          // Solid refs register before insertion; focus only after the row is attached.
          queueMicrotask(() => complete(request));
        }
      }

      onCleanup(() => {
        if (rows.get(value) === row) rows.delete(value);
        keys.delete(row); searches.delete(row);
      });
    },
  };
};

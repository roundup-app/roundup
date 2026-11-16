import { createTypeahead } from "@ui-sdk/core";
import { createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";

type Row = { value: string; label: string };

export type RowSelection = {
  selectedValues: () => string[];
  isEmpty: () => boolean;
  isSelected: (value: string | null) => boolean;
  toggle: (value: string) => void;
  replace: (value: string | null) => void;
  setSelectedValues: (values: string[]) => void;
  clear: () => void;
};

const keys = new WeakMap<Element, (event: KeyboardEvent) => boolean>();

/** Dispatch the focused collection's keys before a modal suppresses unbound input. */
export const rowKey = (event: KeyboardEvent) => event.target instanceof Element
  && keys.get(event.target)?.(event) === true;

/** A modal passes these keys to the focused element's own handler (a tree row) instead of swallowing them. */
export const claimKeys = (element: Element, claims: (event: KeyboardEvent) => boolean) => { keys.set(element, claims); };

// Shortcut guards and the row handler consult the same search for one press.
const searches = new WeakMap<Element, (event: KeyboardEvent) => string | null>();

export const rowTypeahead = (event: KeyboardEvent) => event.target instanceof Element
  && searches.get(event.target)?.(event) != null;

const rowList = (items: readonly Row[]) => {
  const values = items.map(item => item.value);

  const neighbour = (value: string, step: number) => {
    const at = values.indexOf(value);

    return at === -1 ? null : values[at + step] ?? null;
  };

  return {
    items,
    firstValue: values[0] ?? null,
    lastValue: values.at(-1) ?? null,
    getValues: () => [...values],
    has: (value: string) => values.includes(value),
    getNextValue: (value: string) => neighbour(value, 1),
    getPreviousValue: (value: string) => neighbour(value, -1),
    getValueRange: (from: string, to: string) => {
      const start = values.indexOf(from);
      const end = values.indexOf(to);

      return start === -1 || end === -1 ? [] : values.slice(Math.min(start, end), Math.max(start, end) + 1);
    },
  };
};

const createRowSelection = (): RowSelection => {
  const [chosen, setChosen] = createSignal<ReadonlySet<string>>(new Set());
  const selectedValues = createMemo(() => [...chosen()]);
  const isEmpty = createMemo(() => chosen().size === 0);

  return {
    selectedValues, isEmpty,
    isSelected: value => value !== null && chosen().has(value),
    toggle: value => setChosen(previous => new Set(previous.has(value) ? [...previous].filter(each => each !== value) : [...previous, value])),
    replace: value => { if (value !== null) setChosen(new Set([value])); },
    setSelectedValues: values => setChosen(new Set(values)),
    clear: () => setChosen(new Set()),
  };
};

/** Selection, ranges, arrow and Home/End navigation and the buffered name search of existing row buttons. */
export const createRowCollection = (items: () => Row[], interaction?: { onFocus?: (value: string) => void; onActivate: (value: string) => void }, retained?: RowSelection) => {
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => { setMounted(true); });
  // Native hidden/inert changes need a fresh eligibility read at each selection gesture.
  const collection = () => rowList(mounted() ? items() : []);
  const selection = retained ?? createRowSelection();
  const typeahead = createTypeahead(350);
  const results = new WeakMap<KeyboardEvent, string | null>();

  const search = (event: KeyboardEvent) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || event.key === " ") return null;

    if (results.has(event)) return results.get(event)!;
    const row = event.target instanceof HTMLElement ? event.target : null;
    const visible = collection().items;
    const found = typeahead(event.key, visible.map(item => item.label), visible.findIndex(item => item.value === row?.dataset.collectionValue));
    const value = visible[found]?.value ?? null;

    results.set(event, value);

    return value;
  };

  // Refs register without an owner, so nothing releases a removed row: hold it weakly.
  const rows = new Map<string, WeakRef<HTMLElement>>();

  let anchor: string | undefined;
  let pending: { value: string } | null = null;

  createEffect(collection, visible => {
    if (pending && !visible.has(pending.value)) pending = null;
  });

  const complete = (request: { value: string }) => {
    const row = rows.get(request.value)?.deref();

    if (pending !== request || !row?.isConnected || !collection().has(request.value)) return;
    pending = null;
    row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: "nearest" });
  };

  const focusRow = (value: string | null | undefined) => {
    const request = pending = value == null ? null : { value };

    if (!request) return;
    interaction?.onFocus?.(request.value);
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

  onCleanup(() => { pending = null; typeahead.reset(); });

  return {
    collection, selection, search, reset: typeahead.reset, click,
    register: (row: HTMLElement, value: string) => {
      row.dataset.collectionValue = value;
      searches.set(row, search);

      if (interaction) {
        rows.set(value, new WeakRef(row)); keys.set(row, key);
        const request = pending;

        if (request?.value === value) {
          // Solid refs register before insertion; focus only after the row is attached.
          queueMicrotask(() => complete(request));
        }
      }
    },
  };
};

import { createEffect, on, onCleanup, untrack, useContext } from "solid-js";
import { ShelfActions } from "./BulkDelete";
import { createRowCollection } from "../ui/RowCollection";
import type { Accessor } from "solid-js";

/** U458: identities, rather than positions, survive a list refetch. */
export const createSelection = <Id>(ids: Accessor<readonly Id[]>, context: Accessor<string>, find?: (id: Id) => HTMLButtonElement | null | undefined) => {
  const host = useContext(ShelfActions);
  const list = createRowCollection(() => visibleOrder().map(id => ({ value: String(id), label: rowOf(id)?.querySelector(".shelf-title")?.textContent ?? rowOf(id)?.textContent ?? "" })));
  const selected = () => ids().filter(id => list.selection.selectedValues().includes(String(id)));
  const setSelected = (values: readonly Id[]) => untrack(() => list.selection.setSelectedValues(values.map(String)));
  let anchor: Id | undefined;
  const rows = new Map<Id, HTMLButtonElement>();
  const rowOf = find ?? ((id: Id) => rows.get(id));

  const clear = () => {
    setSelected([]);
    anchor = undefined;
    list.reset();
  };

  createEffect(on(() => `${context()}:${host?.open()}`, clear, { defer: true }));
  createEffect(() => {
    const visible = ids();
    setSelected(untrack(selected).filter(id => visible.includes(id)));

    for (const id of rows.keys()) if (!visible.includes(id)) rows.delete(id);

    if (anchor !== undefined && !visible.includes(anchor)) anchor = undefined;
  });
  onCleanup(clear);

  const toggle = (id: Id) => {
    list.selection.toggle(String(id));
    anchor = id;
  };

  const visibleOrder = () => ids().filter(id => {
    const row = rowOf(id);

    return row && !row.disabled && !row.closest("[hidden], [inert], [aria-disabled=true], [data-state=closed]");
  }).sort((a, b) => rowOf(a)!.compareDocumentPosition(rowOf(b)!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  const range = (id: Id) => {
    const collection = list.collection();
    list.selection.setSelectedValues(anchor === undefined || !collection.has(String(anchor)) ? [String(id)] : collection.getValueRange(String(anchor), String(id)));
  };

  const click = (id: Id, event: MouseEvent) => {
    if (event.shiftKey) range(id);
    else if (event.metaKey) toggle(id);
    else {
      list.selection.replace(String(id));
      anchor = id;
      rowOf(id)?.focus();
    }
  };

  const key = (id: Id, event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey) return;

    if (event.key === "Enter" && event.metaKey && !event.shiftKey) {
      event.preventDefault();

      if (!event.repeat) toggle(id);

      return;
    }

    if (event.metaKey && event.key.toLowerCase() === "a" && !event.shiftKey) {
      event.preventDefault();
      list.selection.setSelectedValues(list.collection().getValues());

      return;
    }

    if (event.metaKey || event.isComposing) return;
    const collection = list.collection();
    const value = String(id);

    const nextValue = event.key === "Home" ? collection.firstValue
      : event.key === "End" ? collection.lastValue
      : event.key === "ArrowUp" ? collection.getPreviousValue(value)
      : event.key === "ArrowDown" ? collection.getNextValue(value)
      : list.search(event);

    const navigation = event.key === "Home" || event.key === "End" || event.key === "ArrowUp" || event.key === "ArrowDown";

    if (!navigation && nextValue === null) return;
    event.preventDefault();
    const next = ids().find(id => String(id) === nextValue);

    if (next === undefined || next === id && navigation) return;

    if (event.shiftKey && navigation) {
      anchor ??= id;
      range(next);
    } else if (!navigation) {
      list.selection.replace(String(next));
      anchor = next;
    }

    rowOf(next)?.focus();
  };

  // Capture identities before a confirmation moves focus; resolve their current buttons after refetch.
  const afterRemoval = () => {
    const order = visibleOrder();
    const at = order.findIndex(id => rowOf(id) === document.activeElement);
    const candidates = at < 0 ? [] : [order[at]!, ...order.slice(at + 1), ...order.slice(0, at).reverse()];

    return () => candidates.filter(id => ids().includes(id)).map(rowOf).find(row => row?.isConnected && !row.closest("[hidden], [inert]")) ?? null;
  };

  return {
    afterRemoval,
    focused: () => ids().find(id => rowOf(id) === document.activeElement),
    selected, clear, click, key, toggle,
    cancel: () => { const row = rowOf(selected()[0]!); clear(); row?.focus(); },
    replace: (values: readonly Id[]) => setSelected([...new Set(values)]),
    register: (id: Id, row: HTMLButtonElement | null) => { if (row) { rows.set(id, row); list.register(row, String(id)); } else rows.delete(id); },
  };
};

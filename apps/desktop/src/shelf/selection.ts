import { createEffect, on, onCleanup, untrack, useContext } from "solid-js";
import { createRowCollection } from "../ui/RowCollection";
import { ShelfActions } from "./BulkDelete";
import type { Accessor } from "solid-js";

/** U458: identities, rather than positions, survive a list refetch. */
export const createSelection = <Id>(ids: Accessor<readonly Id[]>, context: Accessor<string>, find?: (id: Id) => HTMLButtonElement | null | undefined) => {
  const host = useContext(ShelfActions);
  const library = createRowCollection();
  const selected = () => library.selection.selectedValues().flatMap(value => ids().filter(id => String(id) === value));
  const setSelected = (values: readonly Id[]) => library.selection.setSelectedValues(values.map(String));
  let anchor: Id | undefined;
  const rows = new Map<Id, HTMLButtonElement>();
  const rowOf = find ?? ((id: Id) => rows.get(id));

  const clear = () => {
    setSelected([]);
    anchor = undefined;
  };

  createEffect(on(() => `${context()}:${host?.open()}`, clear, { defer: true }));
  createEffect(() => {
    const visible = ids();
    untrack(() => setSelected(selected().filter((id) => visible.includes(id))));

    for (const id of rows.keys()) if (!visible.includes(id)) rows.delete(id);

    if (anchor !== undefined && !visible.includes(anchor)) anchor = undefined;
  });
  onCleanup(clear);

  const toggle = (id: Id) => {
    refresh();
    library.selection.toggle(String(id));
    anchor = id;
  };

  const visibleOrder = () => ids().filter(id => {
    const row = rowOf(id);

    return row && !row.disabled && row.getAttribute("aria-disabled") !== "true" && !row.closest("[hidden], [inert], [aria-hidden=true]");
  }).sort((a, b) => rowOf(a)!.compareDocumentPosition(rowOf(b)!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  const refresh = () => library.refresh(visibleOrder().map(id => ({ value: String(id), label: rowOf(id)?.querySelector(".shelf-title")?.textContent ?? rowOf(id)?.textContent ?? "" })));

  const range = (id: Id) => {
    refresh();
    library.selection.setSelectedValues(library.collection().getValueRange(anchor !== undefined && visibleOrder().includes(anchor) ? String(anchor) : String(id), String(id)));
  };

  const click = (id: Id, event: MouseEvent) => {
    if (!visibleOrder().includes(id)) return;

    if (event.shiftKey) range(id);
    else if (event.metaKey) toggle(id);
    else {
      setSelected([id]);
      anchor = id;
      rowOf(id)?.focus();
    }
  };

  const key = (id: Id, event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.isComposing || event.target !== rowOf(id)) return;

    if (event.key === "Enter" && event.metaKey && !event.shiftKey) {
      event.preventDefault();

      if (!event.repeat) toggle(id);

      return;
    }

    refresh();
    const collection = library.collection();

    if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      library.selection.setSelectedValues(collection.getValues());

      return;
    }

    if (event.metaKey) return;
    const current = String(id);

    const next = event.key === "Home" ? collection.firstValue
      : event.key === "End" ? collection.lastValue
      : event.key === "ArrowUp" ? collection.getPreviousValue(current)
      : event.key === "ArrowDown" ? collection.getNextValue(current)
      : event.key.length === 1 && event.key !== " " ? library.search(event.key, current) : null;

    if (next === null) return;
    event.preventDefault();
    const target = ids().find(id => String(id) === next);

    if (target === undefined) return;

    if (event.shiftKey && event.key.length !== 1) {
      anchor ??= id;
      range(target);
    } else if (event.key.length === 1) {
      library.selection.replace(next);
      anchor = target;
    }

    rowOf(target)?.focus();
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
    register: (id: Id, row: HTMLButtonElement | null) => row ? rows.set(id, row) : rows.delete(id),
  };
};

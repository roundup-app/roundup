import { createEffect, createSignal, on, onCleanup, useContext } from "solid-js";
import { ShelfActions } from "./BulkDelete";
import type { Accessor } from "solid-js";

/** U458: identities, rather than positions, survive a list refetch. */
export const createSelection = <Id>(ids: Accessor<readonly Id[]>, context: Accessor<string>, find?: (id: Id) => HTMLButtonElement | null | undefined) => {
  const host = useContext(ShelfActions);
  const [selected, setSelected] = createSignal<readonly Id[]>([]);
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
    setSelected((kept) => kept.filter((id) => visible.includes(id)));

    for (const id of rows.keys()) if (!visible.includes(id)) rows.delete(id);

    if (anchor !== undefined && !visible.includes(anchor)) anchor = undefined;
  });
  onCleanup(clear);

  const toggle = (id: Id) => {
    setSelected((kept) => kept.includes(id) ? kept.filter((other) => other !== id) : [...kept, id]);
    anchor = id;
  };

  const visibleOrder = () => ids().filter(id => {
    const row = rowOf(id);

    return row && !row.closest("[hidden]");
  }).sort((a, b) => rowOf(a)!.compareDocumentPosition(rowOf(b)!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  const range = (id: Id) => {
    const order = visibleOrder();
    const start = anchor === undefined ? -1 : order.indexOf(anchor);
    const end = order.indexOf(id);
    setSelected(start < 0 ? [id] : [...new Set(order.slice(Math.min(start, end), Math.max(start, end) + 1))]);
  };

  const click = (id: Id, event: MouseEvent, open: () => void) => {
    if (event.shiftKey) range(id);
    else if (event.metaKey) toggle(id);
    else {
      clear();
      anchor = id;
      open();
    }
  };

  const key = (id: Id, event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey) return;

    if (event.key === "Enter" && event.metaKey && !event.shiftKey) {
      event.preventDefault();

      if (!event.repeat) toggle(id);

      return;
    }

    if (event.metaKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const order = visibleOrder();
    const next = order[order.indexOf(id) + (event.key === "ArrowUp" ? -1 : 1)];

    if (next === undefined) return;

    if (event.shiftKey) {
      anchor ??= id;
      range(next);
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
    register: (id: Id, row: HTMLButtonElement | null) => row ? rows.set(id, row) : rows.delete(id),
  };
};

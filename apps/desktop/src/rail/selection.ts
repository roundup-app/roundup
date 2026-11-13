import { createEffect, on } from "solid-js";
import { createRowCollection } from "../ui/RowCollection";
import type { ConnectedProject } from "../state/connectedProject";
import { focusedRowId } from "./rows";
import type { NodeRow } from "./layout";

export const createRailSelection = (connected: ConnectedProject, nodeRows: () => NodeRow[], rowElement: (id: string) => HTMLElement | undefined, focusRow: (id: string) => void) => {
  const { rail, daemonExit } = connected;

  const selection = createRowCollection(() => nodeRows().filter(row => {
    const element = rowElement(row.node.id);

    return element && !element.closest("[hidden], [inert], [aria-disabled=true]");
  }).map(row => ({ value: row.node.id, label: row.node.name })));

  let anchor: string | undefined;
  createEffect(on(rail.selected, id => {
    selection.selection.setSelectedValues(id === null ? [] : [id]);
    anchor = id ?? undefined;
  }));

  const range = (id: string) => selection.selection.setSelectedValues(anchor === undefined || !selection.collection().has(anchor)
    ? [id] : selection.collection().getValueRange(anchor, id));

  const selectClick = (event: MouseEvent) => {
    if (event.ctrlKey) return;
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>(".rail-row") : null;
    const id = row?.dataset.id;

    if (id === undefined || event.target instanceof Element && event.target.closest("button,input") || !event.metaKey && !event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();

    if (!selection.collection().has(id)) return;

    if (event.shiftKey) range(id);
    else { selection.selection.toggle(id); anchor = id; }

    row?.focus();
  };

  const selectKey = (event: KeyboardEvent) => {
    const id = focusedRowId(event);

    if (id === undefined || !rail.nodes.some(node => node.id === id) || daemonExit() !== null || event.ctrlKey || event.altKey || event.isComposing) return;

    if (event.metaKey && event.key.toLowerCase() === "a") {
      event.preventDefault(); event.stopPropagation();
      selection.selection.setSelectedValues(selection.collection().getValues());

      return;
    }

    // Ark owns the complete walk, including section headings; selection still contains only data rows.
    if (!event.metaKey && (event.key === "Home" || event.key === "End" || event.key === "ArrowUp" || event.key === "ArrowDown")) return;

    if (event.target instanceof HTMLElement) event.target.dataset.collectionValue = id;
    const match = selection.search(event);

    if (match === null) {
      if (!event.metaKey && event.key.length === 1 && event.key !== " ") {
        event.preventDefault(); event.stopPropagation();
      }

      return;
    }

    event.preventDefault(); event.stopPropagation();
    selection.selection.replace(match); anchor = match; rail.select(match); focusRow(match);
  };

  const anchorAt = (id: string) => { anchor = id; };

  return { selection, selectClick, selectKey, anchorAt };
};

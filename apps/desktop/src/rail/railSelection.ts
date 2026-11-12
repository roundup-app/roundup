import { makeEventListener } from "@solid-primitives/event-listener";
import { createWritableMemo } from "@solid-primitives/memo";
import { createEffect, on } from "solid-js";
import { focusedRowId } from "./rows";

type Inputs = {
  selected: () => string | null;
  isNode: (id: string) => boolean;
  nodeIds: () => string[];
  rowElement: (id: string) => HTMLElement | undefined;
  focusRow: (id: string) => void;
  active: () => boolean;
};

/** The rail's chosen rows: a range runs from the anchor, the last single choice or toggled row; with none, a shift-click selects only its row. */
export const createRowSelection = (inputs: Inputs) => {
  const [selected, replaceSelected] = createWritableMemo<string[]>(() => {
    const id = inputs.selected();

    return id === null ? [] : [id];
  });

  let anchor: string | undefined;

  const setSelected = (values: string[]) => {
    if (values.length === 1) anchor = values[0];
    replaceSelected(values);
  };

  createEffect(on(inputs.selected, id => { anchor = id ?? undefined; }));

  // Only rows the user can act on count: a hidden, inert or disabled row stays out of select-all and ranges.
  const isNodeId = (value: string) => {
    const element = inputs.rowElement(value);

    return inputs.isNode(value) && element !== undefined && !element.closest("[hidden], [inert], [aria-disabled=true]");
  };

  const selectAll = (event: KeyboardEvent) => {
    const id = focusedRowId(event);

    if (id === undefined || !isNodeId(id) || !inputs.active() || !event.metaKey || event.key.toLowerCase() !== "a" || event.ctrlKey || event.altKey || event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    replaceSelected(inputs.nodeIds().filter(isNodeId));
  };

  // A name search chooses the row it lands on; arrows only move focus.
  let typing = false;

  const markTyping = (event: KeyboardEvent) => {
    typing = event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing && focusedRowId(event) !== undefined;

    if (typing) setTimeout(() => { typing = false; });
  };

  const takeTyping = () => {
    const was = typing;
    typing = false;

    return was;
  };

  const modifiedClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || !event.metaKey && !event.shiftKey || !(event.target instanceof Element) || event.target.closest("button,input")) return;
    const id = event.target.closest<HTMLElement>(".rail-row")?.dataset.id;

    if (id === undefined || !isNodeId(id)) return;
    event.preventDefault(); event.stopPropagation();

    if (event.shiftKey) {
      const ids = inputs.nodeIds().filter(isNodeId);
      const from = anchor === undefined ? -1 : ids.indexOf(anchor);
      const to = ids.indexOf(id);
      setSelected(from < 0 ? [id] : ids.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else {
      replaceSelected(selected().includes(id) ? selected().filter(each => each !== id) : [...selected(), id]);
      anchor = id;
    }

    inputs.focusRow(id);
  };

  /** Capture-phase listeners on the tree, ahead of Ark's own. */
  const listen = (element: HTMLElement) => {
    // macOS Ctrl-click opens the menu: it must not focus a row, blur unfinished input, arm the sort sensor or toggle.
    let contextClick = false;

    makeEventListener(element, "pointerdown", (event: PointerEvent) => {
      contextClick = event.button === 0 && event.ctrlKey;

      if (contextClick) { event.preventDefault(); event.stopPropagation(); }
    }, { capture: true });
    // A native menu may consume the compatibility click; keyboard activation must still work next.
    makeEventListener(element, "keydown", () => { contextClick = false; }, { capture: true });
    makeEventListener(element, "click", (event: MouseEvent) => {
      if (!contextClick && !event.ctrlKey) return;

      contextClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, { capture: true });
    makeEventListener(element, "click", modifiedClick, { capture: true });
    makeEventListener(element, "keydown", selectAll, { capture: true });
    makeEventListener(element, "keydown", markTyping, { capture: true });
  };

  return { selected, setSelected, isNodeId, takeTyping, listen, isSelected: (id: string) => selected().includes(id) };
};

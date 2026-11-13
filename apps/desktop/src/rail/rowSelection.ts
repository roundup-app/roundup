import { createEffect } from "solid-js";
import { createWritableMemo } from "@solid-primitives/memo";

// The data row a ⌘- or ⇧-click lands on, outside its own buttons and inputs; null for any other click.
const rowOfModifierClick = (event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target : null;

  if (event.ctrlKey || !event.metaKey && !event.shiftKey || target?.closest("button,input")) return null;

  return target?.closest<HTMLElement>(".rail-row") ?? null;
};

type Deps = {
  initial: () => string | null;
  ids: () => readonly string[];
  isNodeId: (value: string) => boolean;
  rowElement: (id: string) => HTMLElement | undefined;
  focusedRowId: (press: KeyboardEvent) => string | undefined;
  active: () => boolean;
  pick: (id: string) => void;
};

/** What Zag's tree selection lacks for the Rail: data rows only, visible rows only, no implicit anchor, a name search that picks one row. */
export const createRowSelection = (deps: Deps) => {
  const [selected, setSelected] = createWritableMemo<string[]>(() => {
    const chosen = deps.initial();

    return chosen === null ? [] : [chosen];
  });

  const eligible = (id: string) => {
    const row = deps.rowElement(id);

    return row !== undefined && !row.closest("[hidden], [inert], [aria-disabled=true]");
  };

  // ⌘A selects the visible eligible data rows; Zag's own select-all takes every collection value.
  const selectAll = (event: KeyboardEvent) => {
    if (!event.metaKey || event.key.toLowerCase() !== "a" || event.ctrlKey || event.altKey || event.isComposing) return;
    const id = deps.focusedRowId(event);

    if (id === undefined || !deps.isNodeId(id) || !deps.active()) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(deps.ids().filter(eligible));
  };

  // ⇧-click ranges from the last row a click or key selected; with none it selects its target alone, ⌘-click toggles.
  let anchor: string | undefined;
  createEffect(() => {
    const chosen = selected();

    if (chosen.length <= 1) anchor = chosen[0];
  });

  const modifierClick = (event: MouseEvent) => {
    const row = rowOfModifierClick(event);
    const id = row?.dataset.id;

    if (row === null || id === undefined || !deps.isNodeId(id)) return;
    event.preventDefault();
    event.stopPropagation();

    if (!eligible(id)) return;

    if (event.shiftKey) {
      const order = deps.ids().filter(eligible);
      const [from, to] = [anchor === undefined ? -1 : order.indexOf(anchor), order.indexOf(id)];

      setSelected(from < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else {
      anchor = id;
      setSelected(chosen => chosen.includes(id) ? chosen.filter(each => each !== id) : [...chosen, id]);
    }

    row?.focus();
  };

  // Set by a name-search key, kept until the next key or pointer press: the focus move it causes picks that row alone.
  let typing = false;
  const startTyping = (value: boolean) => { typing = value; };

  const chooseTypedMatch = (match: string | null) => {
    if (!typing || match === null || !deps.isNodeId(match)) return;

    typing = false;
    setSelected([match]);
    deps.pick(match);
  };

  return { selected, setSelected, eligible, selectAll, modifierClick, startTyping, chooseTypedMatch, isSelected: (id: string) => selected().includes(id) };
};

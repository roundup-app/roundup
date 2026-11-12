import type { registerKeys } from "../keys/registry";
import type { RailNode } from "@contracts/agent/RailNode";
import { keyedRowIdAt, strandedRow } from "./rows";

type Deps = {
  nodes: () => readonly RailNode[];
  ids: () => readonly string[];
  selected: () => string | null | undefined;
  collapsed: () => ReadonlySet<string>;
  active: () => boolean;
  go: (id: string) => void;
  toggle: (id: string) => void;
};

/** U6829b: the row arrows on the clicked row while a click has left focus on the page body; Ark's tree walks only from a focused row. */
export const strandedRowKeys = (deps: Deps): Parameters<typeof registerKeys>[1] => {
  const plain = (press: KeyboardEvent) => strandedRow(press) && !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey && deps.active();

  return [
    { chords: ["ArrowUp", "ArrowDown"], when: press => plain(press) && keyedRowIdAt(press, deps.selected()) !== undefined, run: press => {
      const ids = deps.ids();
      const next = ids[ids.indexOf(keyedRowIdAt(press, deps.selected()) ?? "") + (press.key === "ArrowDown" ? 1 : -1)];

      if (next !== undefined) deps.go(next);
    } },
    { chords: ["ArrowLeft", "ArrowRight"], when: press => {
      const id = plain(press) ? keyedRowIdAt(press, deps.selected()) : undefined;
      const node = deps.nodes().find(candidate => candidate.id === id);

      return node !== undefined && (node.kind === "workstream" || node.kind === "group") && deps.collapsed().has(node.id) === (press.key === "ArrowRight");
    }, run: press => {
      const id = keyedRowIdAt(press, deps.selected());

      if (id) deps.toggle(id);
    } },
  ];
};

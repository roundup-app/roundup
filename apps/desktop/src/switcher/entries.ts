import { single } from "fuzzysort";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import type { Todo } from "@contracts/todo/Todo";
import type { Pad } from "@contracts/pad/Pad";
import { railOrder } from "../rail/layout";
import { nameOf } from "../bubbles/places";

/** One row of the Switcher: a Rail node, or a Terminal with no Kind that names the Workstream owning it, or a Todo or Pad (U5240b). */
export type Entry = { value: string; label: string; node?: RailNode; terminal?: TerminalInfo; owner?: string; todo?: Todo; pad?: Pad };

const urgency = (entry: Entry): number => {
  const kind = (entry.node?.status ?? entry.terminal?.status)?.kind;

  return kind === "error" ? 0 : kind === "needs-you" ? 1 : 2;
};

/** U529: error, then needs-you, then Rail order; Terminals follow in start order, each among the Agents by the Kind its program reported (PS11.3). Terminals that are an Agent's own screen, or have no owner, are not entries. */
export const entriesOf = (nodes: readonly RailNode[], terminals: readonly TerminalInfo[]): Entry[] => {
  const panes = new Set(nodes.flatMap((node) => node.terminal_id === null ? [] : [node.terminal_id]));
  const rows: Entry[] = railOrder(nodes).map((node) => ({ value: node.id, label: node.name, node }));

  const own: Entry[] = terminals
    .filter((terminal) => terminal.owner !== null && !panes.has(terminal.id))
    .toSorted((a, b) => Number(a.id) - Number(b.id))
    .map((terminal) => ({
      value: `terminal:${terminal.id}`,
      label: nameOf(terminal),
      terminal,
      owner: nodes.find((node) => node.id === terminal.owner)?.name ?? "",
    }));

  return [...rows, ...own].map((entry, at) => ({ entry, at })).sort((a, b) => urgency(a.entry) - urgency(b.entry) || a.at - b.at).map(({ entry }) => entry);
};

/** Z3788b: blank queries retain domain order; fuzzy matches rank stably within each group. */
export const matching = (entries: readonly Entry[], text: string): Entry[] => {
  const needle = text.trim();

  if (!needle) return [...entries];

  return entries
    .flatMap(entry => {
      const match = single(needle, entry.label);

      return match ? [{ entry, score: match.score }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
};

const contains = (text: string, needle: string): boolean => text.toLowerCase().includes(needle.toLowerCase());

/** U5240b: the open Todos, then the Pads, whose title contains the trimmed query, each in the order its list gives, with the name of the Workstream that is its home. Nothing for a blank query. */
export const itemsMatching = (nodes: readonly RailNode[], todos: readonly Todo[], pads: readonly Pad[], text: string): Entry[] => {
  const needle = text.trim();

  if (!needle) return [];

  const owner = (home: string | null) => nodes.find((node) => node.id === home)?.name ?? "";

  return [
    ...todos.filter((todo) => !todo.done && contains(todo.title, needle)).map((todo): Entry => ({ value: `todo:${todo.id}`, label: todo.title, todo, owner: owner(todo.home) })),
    ...pads.filter((pad) => contains(pad.name, needle)).map((pad): Entry => ({ value: `pad:${pad.incarnation}`, label: pad.name, pad, owner: owner(pad.home) })),
  ];
};

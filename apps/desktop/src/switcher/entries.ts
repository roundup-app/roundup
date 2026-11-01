import { single } from "fuzzysort";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { railOrder } from "../rail/layout";
import { nameOf } from "../bubbles/places";

/** One row of the Switcher: a Rail node, or a Terminal with no Kind that names the Workstream owning it. */
export type Entry = { value: string; label: string; node?: RailNode; terminal?: TerminalInfo; owner?: string };

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

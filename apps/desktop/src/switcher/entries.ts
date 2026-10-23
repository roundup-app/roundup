import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { railOrder, resolvedWorkstream } from "../rail/layout";
import { nameOf } from "../bubbles/places";

/** One row of the Switcher: a Rail node, or a Terminal with no Kind that names the Workstream owning it. */
export type Entry = { value: string; label: string; node?: RailNode; terminal?: TerminalInfo; owner?: string };

const urgency = (entry: Entry): number => entry.node?.status?.kind === "error" ? 0 : entry.node?.status?.kind === "needs-you" ? 1 : 2;

/** U529: error, then needs-you, then Rail order; the Terminals follow in start order. Terminals that are an Agent's own screen, or have no owner, are not entries. */
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
      owner: nodes.find((node) => node.id === resolvedWorkstream(nodes, terminal.owner))?.name ?? "",
    }));

  return [...rows.map((entry, at) => ({ entry, at })).sort((a, b) => urgency(a.entry) - urgency(b.entry) || a.at - b.at).map(({ entry }) => entry), ...own];
};

/** The case-blind contains-filter of U51. */
export const matching = (entries: readonly Entry[], text: string): Entry[] => {
  const needle = text.trim().toLowerCase();

  return entries.filter((entry) => entry.label.toLowerCase().includes(needle));
};

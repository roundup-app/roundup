import type { RailNode } from "@contracts/agent/RailNode";
import type { Status } from "@contracts/Status";
import { isDoor } from "../state/doorNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";

/** U5151c: whether the owner dismissed the node's current failure. */
type Dismissed = (node: RailNode) => boolean;

const none: Dismissed = () => false;

/** What counts toward attention: a node or Terminal, whose Status may be absent (a Group has none). */
/** A node's Status; a Group has none. */
export const statusOf = (node: RailNode): Status | null => isDoor(node) ? node.status : null;

export type Holder = { status?: Status | null; alert_level?: RailNode["alert_level"] };

/** Agents and Doors that need the user, most urgent first: Kind `error` before `needs-you`, then the oldest Status. Terminals have no Kind and never count. */
export const attentionOrder = (nodes: readonly RailNode[], dismissed: Dismissed = none): RailNode[] =>
  nodes
    .flatMap((node) => {
      const status = statusOf(node);
      const kind = status?.kind;

      return status && !dismissed(node) && (kind === "error" || kind === "needs-you")
        ? [{ node, rank: kind === "error" ? 0 : 1, since: status.since }]
        : [];
    })
    .sort((a, b) => a.rank - b.rank || a.since - b.since)
    .map(({ node }) => node);

/** The first of `attentionOrder` when `selected` is not in it; otherwise the next, wrapping after the last. `null` when none need you. */
export const nextAttention = (nodes: readonly RailNode[], selected: string | null, dismissed: Dismissed = none): RailNode | null => {
  const order = attentionOrder(nodes, dismissed);
  const at = order.findIndex((node) => node.id === selected);

  return order[(at + 1) % order.length] ?? null;
};

/** PS12: what counts toward attention in one Project: its undismissed nodes and the Terminals that need you (PS11.1), so the count and Needs you agree. */
export const attentionHolders = (nodes: readonly RailNode[], terminals: readonly TerminalInfo[], dismissed: Dismissed = none): Holder[] => [
  ...nodes.filter((node) => node.alert_level !== "quiet" && !dismissed(node)),
  ...terminalAttention(nodes, terminals),
];

/** How many holders of each attention Kind (U182's tooltip reads both). */
export const attentionCounts = (holders: readonly Holder[]) => {
  const kinds = holders.map((holder) => holder.status?.kind);

  return { needsYou: kinds.filter((kind) => kind === "needs-you").length, error: kinds.filter((kind) => kind === "error").length };
};

/** PS11.1: the Terminals that need you, a program having reported `needs-you` or `error`; an Agent's own screen counts through the Agent. */
export const terminalAttention = (nodes: readonly RailNode[], terminals: readonly TerminalInfo[]): TerminalInfo[] => {
  const panes = new Set(nodes.flatMap((node) => !isDoor(node) || node.terminal_id === null ? [] : [node.terminal_id]));

  return terminals.filter((terminal) => !panes.has(terminal.id) && (terminal.status?.kind === "error" || terminal.status?.kind === "needs-you"));
};

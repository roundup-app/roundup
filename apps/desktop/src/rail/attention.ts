import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";

/** U5151c: whether the owner dismissed the node's current failure. */
type Dismissed = (node: RailNode) => boolean;

const none: Dismissed = () => false;

/** Agents and Doors that need the user, most urgent first: Kind `error` before `needs-you`, then the oldest Status. Terminals have no Kind and never count. */
export const attentionOrder = (nodes: readonly RailNode[], dismissed: Dismissed = none): RailNode[] =>
  nodes
    .flatMap((node) => {
      const kind = node.status?.kind;

      return node.status && !dismissed(node) && (kind === "error" || kind === "needs-you")
        ? [{ node, rank: kind === "error" ? 0 : 1, since: node.status.since }]
        : [];
    })
    .sort((a, b) => a.rank - b.rank || a.since - b.since)
    .map(({ node }) => node);

export const attentionCount = (nodes: readonly RailNode[], dismissed: Dismissed = none): number => attentionOrder(nodes, dismissed).length;

/** The first of `attentionOrder` when `selected` is not in it; otherwise the next, wrapping after the last. `null` when none need you. */
export const nextAttention = (nodes: readonly RailNode[], selected: string | null, dismissed: Dismissed = none): RailNode | null => {
  const order = attentionOrder(nodes, dismissed);
  const at = order.findIndex((node) => node.id === selected);

  return order[(at + 1) % order.length] ?? null;
};

/** PS12: what counts toward attention in one Project: its undismissed nodes, and each Terminal with a program status that no node owns (an Agent's own Terminal reaches it as the Agent's Kind, PS9). */
export const attentionHolders = (nodes: readonly RailNode[], terminals: readonly TerminalInfo[], dismissed: Dismissed = none): Pick<RailNode, "status">[] => [
  ...nodes.filter((node) => !dismissed(node)),
  ...terminals.flatMap((terminal) => terminal.status && !nodes.some((node) => node.terminal_id === terminal.id) ? [{ status: terminal.status }] : []),
];

/** How many holders of each attention Kind (U182's tooltip reads both). */
export const attentionCounts = (holders: readonly Pick<RailNode, "status">[]) => {
  const kinds = holders.map((holder) => holder.status?.kind);

  return { needsYou: kinds.filter((kind) => kind === "needs-you").length, error: kinds.filter((kind) => kind === "error").length };
};

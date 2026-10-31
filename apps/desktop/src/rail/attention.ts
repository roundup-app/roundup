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

/** How many Agents of each attention Kind (U182's tooltip reads both); Terminals have no Status and never count. */
export const attentionCounts = (nodes: readonly RailNode[], dismissed: Dismissed = none) => {
  const kinds = nodes.map((node) => dismissed(node) ? undefined : node.status?.kind);

  return { needsYou: kinds.filter((kind) => kind === "needs-you").length, error: kinds.filter((kind) => kind === "error").length };
};

/** PS11.1: the Terminals that need you, a program having reported `needs-you` or `error`; an Agent's own screen counts through the Agent. */
export const terminalAttention = (nodes: readonly RailNode[], terminals: readonly TerminalInfo[]): TerminalInfo[] => {
  const panes = new Set(nodes.flatMap((node) => node.terminal_id === null ? [] : [node.terminal_id]));

  return terminals.filter((terminal) => !panes.has(terminal.id) && (terminal.status?.kind === "error" || terminal.status?.kind === "needs-you"));
};

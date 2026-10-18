import type { RailNode } from "@contracts/agent/RailNode";

/** Agents and Doors that need the user, most urgent first: Kind `error` before `needs-you`, then the oldest Status. Terminals have no Kind and never count. */
export const attentionOrder = (nodes: readonly RailNode[]): RailNode[] =>
  nodes
    .flatMap((node) => {
      const kind = node.status?.kind;

      return node.status && (kind === "error" || kind === "needs-you")
        ? [{ node, rank: kind === "error" ? 0 : 1, since: node.status.since }]
        : [];
    })
    .sort((a, b) => a.rank - b.rank || a.since - b.since)
    .map(({ node }) => node);

export const attentionCount = (nodes: readonly RailNode[]): number => attentionOrder(nodes).length;

/** The first of `attentionOrder` when `selected` is not in it; otherwise the next, wrapping after the last. `null` when none need you. */
export const nextAttention = (nodes: readonly RailNode[], selected: string | null): RailNode | null => {
  const order = attentionOrder(nodes);
  const at = order.findIndex((node) => node.id === selected);

  return order[(at + 1) % order.length] ?? null;
};

/** How many Agents of each attention Kind (U182's tooltip reads both); Terminals have no Status and never count. */
export const attentionCounts = (nodes: readonly RailNode[]) => {
  const kinds = nodes.map((node) => node.status?.kind);

  return { needsYou: kinds.filter((kind) => kind === "needs-you").length, error: kinds.filter((kind) => kind === "error").length };
};

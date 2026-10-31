import type { RailNode } from "@contracts/agent/RailNode";
import type { UnreadComment } from "@contracts/todo/UnreadComment";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { attentionOrder, terminalAttention } from "../rail/attention";

/** `error` before `needs-you`, then the oldest Status: the order of `attentionOrder`, Terminals among the Agents. */
const rankOf = (kind: string | undefined) => kind === "error" ? 0 : 1;

/** Attention order establishes the groups; comment-only Agents follow in unread order. */
export const sectionsOf = (nodes: readonly RailNode[], comments: readonly UnreadComment[], dismissed?: (node: RailNode) => boolean, terminals: readonly TerminalInfo[] = []) => {
  const attention = [
    ...attentionOrder(nodes, dismissed).map(node => ({ id: node.id, node, terminal: undefined, rank: rankOf(node.status?.kind), since: node.status?.since ?? 0 })),
    ...terminalAttention(nodes, terminals).map(terminal => ({ id: `terminal:${terminal.id}`, node: undefined, terminal, rank: rankOf(terminal.status?.kind), since: terminal.status?.since ?? 0 })),
  ].sort((a, b) => a.rank - b.rank || a.since - b.since);

  const ids = [...new Set([...attention.map(entry => entry.id), ...comments.map(row => row.comment.author.id)])];

  return ids.map(id => {
    const entry = attention.find(each => each.id === id);

    return { id, node: entry?.node, terminal: entry?.terminal, comments: comments.filter(row => row.comment.author.id === id) };
  });
};

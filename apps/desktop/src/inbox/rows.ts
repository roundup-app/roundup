import type { RailNode } from "@contracts/agent/RailNode";
import type { UnreadComment } from "@contracts/todo/UnreadComment";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { attentionOrder, type Dismissed } from "../rail/attention";

/** Attention order establishes the groups; comment-only Agents follow in unread order. */
export const sectionsOf = (nodes: readonly RailNode[], comments: readonly UnreadComment[], dismissed?: Dismissed, terminals: readonly TerminalInfo[] = []) => {
  const attention = attentionOrder(nodes, terminals, dismissed).map(entry => entry.kind === "agent"
    ? { id: entry.node.id, node: entry.node, terminal: undefined }
    : { id: `terminal:${entry.terminal.id}`, node: undefined, terminal: entry.terminal });

  const ids = [...new Set([...attention.map(entry => entry.id), ...comments.map(row => row.comment.author.id)])];

  return ids.map(id => {
    const entry = attention.find(each => each.id === id);

    return { id, node: entry?.node, terminal: entry?.terminal, comments: comments.filter(row => row.comment.author.id === id) };
  });
};

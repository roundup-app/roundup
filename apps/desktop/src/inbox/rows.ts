import type { RailNode } from "@contracts/agent/RailNode";
import type { UnreadComment } from "@contracts/todo/UnreadComment";
import { attentionOrder } from "../rail/attention";

/** Attention order establishes the groups; comment-only Agents follow in unread order. */
export const sectionsOf = (nodes: readonly RailNode[], comments: readonly UnreadComment[], dismissed?: (node: RailNode) => boolean) => {
  const attention = attentionOrder(nodes, dismissed);
  const ids = [...new Set([...attention.map(node => node.id), ...comments.map(row => row.comment.author.id)])];

  return ids.map(id => ({ id, node: attention.find(node => node.id === id), comments: comments.filter(row => row.comment.author.id === id) }));
};

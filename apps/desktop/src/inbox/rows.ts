import type { RailNode } from "@contracts/agent/RailNode";
import { attentionOrder } from "../rail/attention";

/** U3770a: the Agents of each section, in the order the section shows them. */
export const sectionsOf = (nodes: readonly RailNode[]) => ({
  needs: attentionOrder(nodes),
  running: nodes.filter((node) => node.kind === "agent" && node.status?.kind === "working"),
  done: nodes.filter((node) => node.kind === "agent" && node.status?.kind === "done").toSorted((a, b) => b.status!.since - a.status!.since),
});

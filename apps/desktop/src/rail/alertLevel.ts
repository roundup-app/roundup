import type { RailNode } from "@contracts/agent/RailNode";
import { descendantsOf } from "./layout";

/** U5501: a Workstream choice describes its current Agents, never future inheritance. */
export const alertLevel = (nodes: readonly RailNode[], node: RailNode) => {
  if (node.kind === "agent") return node.alert_level ?? "default";
  const agents = [node, ...descendantsOf(nodes, node.id)].filter(each => each.kind === "agent" || each.attempt !== null);
  const first = agents[0]?.alert_level ?? "default";

  return agents.length && agents.every(each => (each.alert_level ?? "default") === first) ? first : null;
};

import type { RailNode } from "@contracts/agent/RailNode";

/** RO5: a node that has a Door's facts (`status`, `attempt`, `terminal_id`, `worktree`, ...): a Workstream or an Agent. */
export type DoorNode = Extract<RailNode, { kind: "workstream" | "agent" }>;

/** RO5: narrow on `kind` before reading a field a Group lacks. */
export const isDoor = (node: RailNode): node is DoorNode => node.kind !== "group";

import type { RailNode } from "@contracts/agent/RailNode";

/** RO5: a node that has a Door's facts (`status`, `attempt`, `terminal_id`, `worktree`, ...): a Workstream or an Agent. */
export type DoorNode = Extract<RailNode, { kind: "workstream" | "agent" }>;

/** RO5: narrow on `kind` before reading a field a Group lacks. */
export const isDoor = (node: RailNode): node is DoorNode => node.kind !== "group";

/** RO5: a Door's `attempt`, `null` for a Group. */
export const doorAttempt = (node: RailNode) => (isDoor(node) ? node.attempt : null);

/** RO5: whether the Door's Attempt is later than `than`; never for a Group or before a first Attempt. */
export const attemptAfter = (node: RailNode, than: string | null | undefined) => {
  const attempt = doorAttempt(node);

  return attempt !== null && BigInt(attempt) > BigInt(than ?? "0");
};

/** RO5: whether the Door was started with permission prompts off. */
export const isYolo = (node: RailNode) => isDoor(node) && node.yolo;

/** U7191b: whether the Daemon holds a saved conversation for the Door, running or exited. */
export const hasConversation = (node: RailNode) => isDoor(node) && node.has_conversation;

/** RO5: a Door's `status`, or `null` for a Group or an absent node. */
export const doorStatus = (node: RailNode | null | undefined) => (node && isDoor(node) ? node.status : null);

/** RO5: the Terminal behind a Door, or `null`. */
export const doorTerminalId = (node: RailNode | null | undefined) => (node && isDoor(node) ? node.terminal_id : null);

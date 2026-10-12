import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";

const UNPROMPTED: readonly Kind[] = ["blocked", "needs-you", "error"];

/** The Live line: the Status label alone (U393). */
export type LiveLine = { label: string };

/** What the row shows on its Live line, or `null` when it shows none. */
export const liveLineOf = (node: RailNode): LiveLine | null => (node.status ? { label: node.status.label } : null);

/** Hidden until hover or selection, except when the Agent needs the user's eye. */
export const isUnprompted = (node: RailNode): boolean => node.status !== null && UNPROMPTED.includes(node.status.kind);

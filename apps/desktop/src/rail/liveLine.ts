import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { elapsed } from "../ink/elapsed";

const UNPROMPTED: readonly Kind[] = ["blocked", "needs-you", "error"];

/** The Live line's label and, for an Agent or Door, its elapsed time pinned after it (U7); no age without a Status. */
export type LiveLine = { label: string; age: string | null };

/** What the row shows on its Live line, or `null` when it shows none. */
export const liveLineOf = (node: RailNode, now: number): LiveLine | null => {
  if (node.status) return { label: node.status.label, age: elapsed(node.status.since, now) };

  return null;
};

/** The Live line's `title`: the whole label and age, which the row may cut. */
export const liveTitleOf = (line: LiveLine): string => (line.age !== null ? `${line.label}  ${line.age}` : line.label);

/** Hidden until hover or selection, except when the Agent needs the user's eye. */
export const isUnprompted = (node: RailNode): boolean => node.status !== null && UNPROMPTED.includes(node.status.kind);

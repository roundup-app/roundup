import type { Pad } from "@contracts/pad/Pad";
import type { PadMark, PadRead } from "./padRead";

/** U7499a: a `shown` Pad no one has written for this long is idle. */
const IDLE_AFTER_MS = 7 * 86_400_000;

export type FoldedPads = {
  /** In the group's order, each with the dot it carries. */
  above: { pad: Pad; mark: PadMark }[];
  internal: Pad[];
  idle: Pad[];
};

/** U7499a, U7499b: the Pads above the folds and the two folds of one Home group, in the group's order. The open Pad stays above the folds. */
export const foldPads = (pads: readonly Pad[], read: PadRead, now: number, open: string | null): FoldedPads => {
  const folded: FoldedPads = { above: [], internal: [], idle: [] };

  for (const pad of pads) {
    const mark = read.mark(pad);

    if (pad.name === open) folded.above.push({ pad, mark });
    else if (pad.visibility === "internal") folded.internal.push(pad);
    else if (mark === null || now - pad.updated_at >= IDLE_AFTER_MS) folded.idle.push(pad);
    else folded.above.push({ pad, mark });
  }

  return folded;
};

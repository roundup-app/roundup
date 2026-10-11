import type { Pad } from "@contracts/pad/Pad";

/** P13, U190: the Scribe of `pad`, from the Daemon's answer alone, so a reopened App or Project finds its exchange. */
export const scribeOf = (pad: Pad | undefined): string | null => pad?.scribe ?? null;

/** P13, U190 **Rail**: the ids of every Scribe the Daemon names for these Pads. */
export const scribeIds = (pads: readonly Pad[]): ReadonlySet<string> =>
  new Set(pads.flatMap((pad) => (pad.scribe === null ? [] : [pad.scribe])));

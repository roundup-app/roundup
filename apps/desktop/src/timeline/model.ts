import type { Kind } from "@contracts/Kind";

/** The window the timeline shows, ending at "now". */
export const WINDOW_MS = 30 * 60_000;

/** One Status an Agent was seen in: its Kind from `at` (the Status `since`) within one Attempt. */
export type Sample = { at: number; attempt: string; kind: Kind };

export type Block = { kind: Kind; attempt: string; start: number; end: number; open: boolean };

/**
 * U3768b: a block runs from one Sample to the next; the last one is open and ends at `now`.
 * A `done` Sample ends the block before it and starts none. A new Attempt starts a new block even when the Kind repeats;
 * a repeated Kind within an Attempt continues the same block.
 */
export const blocksOf = (samples: readonly Sample[], now: number): Block[] => {
  const ordered = samples.toSorted((a, b) => a.at - b.at);
  const blocks: Block[] = [];

  ordered.forEach((sample, at) => {
    if (sample.kind === "done") return;
    const next = ordered[at + 1];
    const last = blocks.at(-1);

    if (last && last.kind === sample.kind && last.attempt === sample.attempt && last.end === sample.at) {
      last.end = next?.at ?? now;
      last.open = next === undefined;

      return;
    }

    blocks.push({ kind: sample.kind, attempt: sample.attempt, start: sample.at, end: next?.at ?? now, open: next === undefined });
  });

  return blocks;
};

/** Adds `sample` unless the same Status was seen already; the Rail seeds and the Events repeat each other. */
export const withSample = (samples: readonly Sample[], sample: Sample): readonly Sample[] =>
  samples.some((each) => each.at === sample.at && each.attempt === sample.attempt && each.kind === sample.kind) ? samples : [...samples, sample];

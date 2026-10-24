import { countsTime } from "@contracts/agentTime";
import type { Kind } from "@contracts/Kind";

/** The window the timeline shows, ending at "now". */
export const WINDOW_MS = 30 * 60_000;

/** One Status an Agent was seen in: its Kind from `at` (the Status `since`) within one Attempt. */
export type Sample = { at: number; attempt: string; kind: Kind; ended?: boolean; recorded?: boolean };

export type Block = { kind: Kind; attempt: string; start: number; end: number; open: boolean };

/**
 * U3768b: a block runs from one Sample to the next; the last one is open and ends at `now`.
 * An idle or ended Sample closes the block before it and starts none. A new Attempt starts a new block even when the Kind repeats;
 * a repeated Kind within an Attempt continues the same block.
 */
export const blocksOf = (samples: readonly Sample[], now: number): Block[] => {
  const ordered = samples.toSorted((a, b) => a.at - b.at);
  const blocks: Block[] = [];

  ordered.forEach((sample, at) => {
    if (!countsTime(sample.kind, sample.ended ?? false)) return;
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
export const withSample = (samples: readonly Sample[], sample: Sample): readonly Sample[] => {
  const sameAttempt = (each: Sample) => each.attempt === sample.attempt;

  // A Rail read cannot move a boundary already recorded by the Event log.
  if (!sample.recorded && samples.some(each => sameAttempt(each) && each.recorded && each.at >= sample.at)) return samples;
  const retained = sample.recorded ? samples.filter(each => each.recorded || !sameAttempt(each) || (each.at !== sample.at && (!each.ended || each.at > sample.at))) : samples;
  const source = retained.length === samples.length ? samples : retained;
  const existing = source.find(each => each.at === sample.at && sameAttempt(each) && each.kind === sample.kind);

  if (!existing) return [...source, sample];

  if (existing.recorded === sample.recorded && (existing.ended || !sample.ended)) return source;

  return source.map(each => each === existing ? sample : each);
};

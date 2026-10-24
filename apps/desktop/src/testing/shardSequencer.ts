import { relative } from "node:path";
import { BaseSequencer } from "vitest/node";
import type { TestSpecification } from "vitest/node";
import measuredDurations from "./shardDurations.json" with { type: "json" };

type Seconds = Readonly<Record<string, number>>;

interface Shard {
  weights: number[];
  files: string[];
}

// A shard's test files run side by side on a 4-vCPU runner: measured on `main`, a shard takes about its longest file, or
// its summed file time over this many files at once, whichever is longer.
const PARALLEL_FILES = 2.8;

// A file's environment and imports cost this much besides the duration vitest prints for it: on `main`, they took 36%
// of the time of a shard holding 117 files, about two seconds a file.
const FILE_SETUP_SECONDS = 2;

const durations: Seconds = measuredDurations;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? 1;
};

/** What a shard holding files of these durations takes, in seconds. */
export const shardTime = (held: readonly number[]): number => Math.max(0, ...held, held.reduce((sum, seconds) => sum + seconds + FILE_SETUP_SECONDS, 0) / PARALLEL_FILES);

/** The files, longest measured duration first (a file without one weighs the median), ties by name. */
export function longestFirst(files: readonly string[], measured: Seconds): string[] {
  const fallback = median(Object.values(measured));
  const weight = (file: string) => measured[file] ?? fallback;

  return [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
}

/**
 * Longest first, each file goes to the shard it makes finish soonest (the emptier one on a tie), so a file longer than
 * a fair share keeps a shard nearly to itself. Files without a measured duration weigh the median. Every shard computes
 * the same answer from the same file list, so the shards partition it. Returns, per shard (0-based), the files it runs.
 */
export function assignShards(files: readonly string[], measured: Seconds, count: number): string[][] {
  const fallback = median(Object.values(measured));
  const weight = (file: string) => measured[file] ?? fallback;
  const shards = Array.from({ length: count }, (): Shard => ({ weights: [], files: [] }));

  for (const file of longestFirst(files, measured)) {
    const finishes = (shard: Shard) => shardTime([...shard.weights, weight(file)]);

    const soonest = shards.reduce((best, shard) => {
      const gap = finishes(shard) - finishes(best);

      return gap < 0 || (gap === 0 && shard.weights.length < best.weights.length) ? shard : best;
    });

    soonest.weights.push(weight(file));
    soonest.files.push(file);
  }

  return shards.map((shard) => shard.files);
}

/** Vitest's `--shard` hook: balances shards by the durations measured on `main` (`just web-durations`), not by path hash. */
export default class TimedSequencer extends BaseSequencer {
  override async shard(specs: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;

    if (!shard) return specs;
    const byFile = new Map(specs.map((spec) => [relative(root, spec.moduleId), spec]));
    const mine = assignShards([...byFile.keys()], durations, shard.count)[shard.index - 1] ?? [];

    return mine.flatMap((file) => byFile.get(file) ?? []);
  }

  // Vitest sorts after it shards, by file size when it has no earlier run to read: a browser test is a small file that
  // runs for minutes, so left to that order it starts last and the shard waits on its tail. Start the longest first.
  override async sort(specs: TestSpecification[]): Promise<TestSpecification[]> {
    const { root } = this.ctx.config;
    const byFile = new Map(specs.map((spec) => [relative(root, spec.moduleId), spec]));

    return longestFirst([...byFile.keys()], durations).flatMap((file) => byFile.get(file) ?? []);
  }
}

import { relative } from "node:path";
import { BaseSequencer } from "vitest/node";
import type { TestSpecification } from "vitest/node";
import measuredDurations from "./shardDurations.json" with { type: "json" };

type Seconds = Readonly<Record<string, number>>;

interface Shard {
  load: number;
  files: string[];
}

const durations: Seconds = measuredDurations;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? 1;
};

/**
 * Longest-processing-time-first: each file, longest first, goes to the least loaded shard. Files without a measured
 * duration weigh the median. Every shard computes the same answer from the same file list, so the shards partition it.
 * Returns, per shard (0-based), the files it runs.
 */
export function assignShards(files: readonly string[], measured: Seconds, count: number): string[][] {
  const fallback = median(Object.values(measured));
  const weight = (file: string) => measured[file] ?? fallback;
  const shards = Array.from({ length: count }, (): Shard => ({ load: 0, files: [] }));

  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1))) {
    const lightest = shards.reduce((least, shard) => (shard.load < least.load ? shard : least));

    lightest.load += weight(file);
    lightest.files.push(file);
  }

  return shards.map((shard) => shard.files);
}

/** Vitest's `--shard` hook: balances shards by the durations measured on `main` (`just web-durations`), not by path hash. */
export default class TimedSequencer extends BaseSequencer {
  // fallow-ignore-next-line unused-class-member -- vitest calls it for `--shard`
  override async shard(specs: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;

    if (!shard) return specs;
    const byFile = new Map(specs.map((spec) => [relative(root, spec.moduleId), spec]));
    const mine = assignShards([...byFile.keys()], durations, shard.count)[shard.index - 1] ?? [];

    return mine.flatMap((file) => byFile.get(file) ?? []);
  }
}

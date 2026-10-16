import { globSync } from "node:fs";
import { expect, test } from "vitest";
import measuredDurations from "./shardDurations.json" with { type: "json" };
import { assignShards } from "./shardSequencer";

const durations: Record<string, number> = measuredDurations;

const files = globSync("src/**/*.test.{ts,tsx}");

const load = (shard: string[]) => shard.reduce((sum, file) => sum + (durations[file] ?? 0), 0);

// L89: the web shards are balanced by measured time and drop no file.
test("t_l89_web_shards_hold_every_file_once_and_stay_balanced", () => {
  for (const count of [5, 6, 7, 8]) {
    const shards = assignShards(files, durations, count);

    expect(shards.flat().sort()).toEqual([...files].sort());
    const loads = shards.map(load);
    const ideal = loads.reduce((a, b) => a + b, 0) / count;
    const longestFile = Math.max(...files.map((file) => durations[file] ?? 0));

    expect(Math.max(...loads)).toBeLessThanOrEqual(Math.max(ideal * 1.1, longestFile));
  }
});

test("t_l89_web_shards_weigh_a_new_file_as_the_median", () => {
  const known = { "src/a.test.ts": 10, "src/b.test.ts": 30, "src/c.test.ts": 20 };
  const shards = assignShards(["src/a.test.ts", "src/b.test.ts", "src/c.test.ts", "src/new.test.ts"], known, 2);

  // The new file weighs the median, 20: b | c, then new joins c (20 < 30), then a joins b.
  expect(shards.map((shard) => shard.sort())).toEqual([["src/b.test.ts", "src/a.test.ts"].sort(), ["src/c.test.ts", "src/new.test.ts"].sort()]);
});

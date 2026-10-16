import { globSync } from "node:fs";
import { expect, test } from "vitest";
import measuredDurations from "./shardDurations.json" with { type: "json" };
import { assignShards, shardTime } from "./shardSequencer";

const durations: Record<string, number> = measuredDurations;

const files = globSync("src/**/*.test.{ts,tsx}");

const time = (shard: string[]) => shardTime(shard.map((file) => durations[file] ?? 0));

// L89: the web shards are balanced by measured time and drop no file.
test("t_l89_web_shards_hold_every_file_once_and_stay_balanced", () => {
  for (const count of [5, 6, 7]) {
    const shards = assignShards(files, durations, count);

    expect(shards.flat().sort()).toEqual([...files].sort());
    const times = shards.map(time);
    const fairShare = time(files) / count;
    const longestFile = Math.max(...files.map((file) => durations[file] ?? 0));

    // The longest file sets a floor no split can lower; the rest of the files add no more than a tenth over a fair share.
    expect(Math.max(...times)).toBeLessThanOrEqual(Math.max(fairShare * 1.1, longestFile));
  }
});

test("t_l89_web_shards_keep_a_file_longer_than_a_fair_share_apart_and_place_a_new_file", () => {
  const shards = assignShards(["src/big.test.ts", "src/a.test.ts", "src/b.test.ts", "src/new.test.ts"], { "src/big.test.ts": 100, "src/a.test.ts": 10, "src/b.test.ts": 10 }, 2);

  expect(shards).toEqual([["src/big.test.ts"], ["src/a.test.ts", "src/b.test.ts", "src/new.test.ts"]]);
});

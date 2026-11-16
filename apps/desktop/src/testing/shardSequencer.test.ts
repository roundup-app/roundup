import { globSync } from "node:fs";
import { expect, test } from "vitest";
import measuredDurations from "./shardDurations.json" with { type: "json" };
import { assignShards, longestFirst, shardCount, shardTime } from "./shardSequencer";

const durations: Record<string, number> = measuredDurations;

const files = globSync("src/**/*.test.{ts,tsx}");

const time = (shard: string[]) => shardTime(shard.map((file) => durations[file] ?? 0));

// L89: the web shards are balanced by measured time and drop no file.
test("t_l89_web_shards_hold_every_file_once_and_stay_balanced", () => {
  for (const count of [5, 9]) {
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

// L89: a shard starts its longest files first, so no long browser test starts last and sets the shard's tail.
test("t_l89_web_shards_start_the_longest_file_first", () => {
  expect(longestFirst(["src/a.test.ts", "src/new.test.ts", "src/big.test.ts", "src/b.test.ts"], { "src/big.test.ts": 100, "src/a.test.ts": 10, "src/b.test.ts": 10 })).toEqual(["src/big.test.ts", "src/a.test.ts", "src/b.test.ts", "src/new.test.ts"]);
});

test("t_l89_web_shards_balance_serial_files_after_parallel_work", () => {
  const measured = { "app-a": 100, "app-b": 100, "app-c": 100, "heavy-a": 90, "heavy-b": 90 };
  const weights = new Map(Object.entries(measured));
  const serial = new Set(["heavy-a", "heavy-b"]);
  const shards = assignShards(Object.keys(measured), measured, 2, serial);

  // Each heavy file occupies its worker alone, after App work. Putting both on one shard exceeds 250 seconds.
  for (const shard of shards) {
    const parallel = shard.flatMap(file => serial.has(file) ? [] : weights.get(file) ?? 0);
    const seconds = shardTime(parallel) + shard.reduce((sum, file) => sum + (serial.has(file) ? (weights.get(file) ?? 0) + 2 : 0), 0);

    expect(seconds).toBeLessThan(210);
  }
});

// CI7295a: a run gets the fewest shards that keep each one's measured time within the budget, serial files counted whole.
test("ci7295a_web_runs_get_the_fewest_shards_within_the_time_budget", () => {
  const measured = { "app-a": 100, "app-b": 100, "app-c": 100, "heavy-a": 90 };
  const serial = new Set(["heavy-a"]);
  const apps = ["app-a", "app-b", "app-c"];

  // Three 100 s files on one shard take max(100, 306 / 2) = 153 s; two on a shard take max(100, 204 / 2) = 102 s.
  expect(shardCount(apps, measured, 160, 9)).toBe(1);
  expect(shardCount(apps, measured, 110, 9)).toBe(2);
  // The serial file adds its whole 92 s to the shard it joins: only a fourth shard holds it within 100 s.
  expect(shardCount(Object.keys(measured), measured, 100, 9, serial)).toBe(4);
  // A budget below the slowest file rises to that file's own time, 100 s, which only one file a shard keeps.
  expect(shardCount(apps, measured, 50, 9)).toBe(3);
  // The cap holds when the budget wants more shards.
  expect(shardCount(apps, measured, 100, 1)).toBe(1);
});
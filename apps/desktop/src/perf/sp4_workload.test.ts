import { expect, it } from "vitest";
import { summarize } from "./switch_run";

it("sp4_summary_discards_the_warm_up_and_ranks_by_nearest_rank", () => {
  const all = [...Array.from({ length: 10 }, () => 900), ...Array.from({ length: 100 }, (_, index) => index + 1)];

  expect(summarize(all, 10, 3)).toEqual({ n: 100, dropped: 3, p50: 50, p95: 95, p99: 99, max: 100 });
});

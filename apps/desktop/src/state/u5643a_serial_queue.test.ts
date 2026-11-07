import PQueue from "p-queue";
import { expect, it } from "vitest";

// U5643a: the draft writes keep order and the first starts in the tick of `add`; p-queue at concurrency 1 supplies both.
it("u5643a_serial_queue_keeps_order_and_starts_in_the_same_tick", async () => {
  const queue = new PQueue({ concurrency: 1 });
  const log: string[] = [];
  const first = queue.add(async () => { log.push("first:start"); await Promise.resolve(); log.push("first:end"); });
  expect(log).toEqual(["first:start"]);
  const second = queue.add(() => { log.push("second"); });
  await Promise.all([first, second, queue.onIdle()]);
  expect(log).toEqual(["first:start", "first:end", "second"]);
});

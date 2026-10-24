import { expect, it } from "vitest";
import { recordFrames } from "./frames";

it("u3010d_the_native_trace_can_locate_the_sample_after_setup_and_warmup", async () => {
  let next: (at: number) => void = () => {};
  const done = recordFrames(
    {
      frame: (callback) => void (next = callback),
      hidden: () => false,
      now: () => 0,
      afterUpdate: (callback) => callback(),
      after: () => {},
    },
    { workload: "layers", engine: "webkit", timerResolutionMs: 1, userAgent: "test", timeOriginMs: 1_000_000 },
    async () => true,
    { warmup: 100, sample: 600, idle: 300 },
  );

  // Setup took 237 ms; the sample begins 100 ms after the first recorded callback.
  for (let at = 237; at <= 1237; at += 10) next(at);

  expect((await done).windows_epoch_ms).toEqual({ sample_start: 1_000_337, sample_end: 1_000_937, idle_end: 1_001_237 });
});

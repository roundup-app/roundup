import { describe, expect, it } from "vitest";
import { buildReport, recordFrames } from "./frames";
import type { Facts, Frames } from "./frames";

const WINDOWS = { warmup: 100, sample: 600, idle: 300 };

const describing = { workload: "glyphs", engine: "chromium", timerResolutionMs: 0.1, userAgent: "test" } as const;

/** A frame clock the test steps: each `step` delivers one frame at the given timestamp. */
const clock = (hidden = () => false) => {
  let next: ((at: number) => void) | null = null;
  let wall: (() => void) | null = null;
  let now = 0;

  const frames: Frames = {
    frame: (callback) => void (next = callback),
    hidden,
    now: () => now,
    // The rendering update of a frame costs 3 ms on this clock.
    afterUpdate: (callback) => {
      now += 3;
      callback();
    },
    after: (_ms, callback) => void (wall = callback),
  };

  return {
    frames,
    at: (stamps: number[]) => stamps.forEach((stamp) => ((now = stamp), next?.(stamp))),
    waiting: () => next !== null,
    wallClockRuns: () => wall?.(),
  };
};

const evenly = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, index) => from + index * step);

const facts = (over: Partial<Facts> = {}): Facts => ({
  ...describing,
  hz: 60,
  sample: Array(600).fill(16.7),
  idle: Array(300).fill(16.7),
  hidden: false,
  completed: true,
  actionsDone: true,
  ...over,
});

describe("u3010e the frame recorder", () => {
  it("u3010e_only_the_named_workload_window_is_sampled", async () => {
    const time = clock();
    const done = recordFrames(time.frames, describing, async () => true, WINDOWS);

    time.at(evenly(0, 1100, 10));

    const report = await done;

    expect(report.sample.n).toBe(60);
    expect(report.idle.n).toBe(30);
    expect(time.waiting()).toBe(true);
    expect(report.sample.intervals.every((interval) => interval === 10)).toBe(true);
  });

  it("u3010e_a_silent_frame_clock_still_reports_invalid", async () => {
    const time = clock();
    const done = recordFrames(time.frames, describing, async () => true, WINDOWS);

    time.at(evenly(0, 50, 10));
    time.wallClockRuns();

    const report = await done;

    expect(report).toMatchObject({ verdict: "invalid", exit: 2 });
    expect(report.invalid).toContain("the frame clock delivered no frame before the wall-clock bound");
  });

  it("u3010e_the_report_holds_raw_intervals_and_nearest_rank_percentiles", () => {
    const sample = [...Array(97).fill(16), 20, 30, 40];
    const report = buildReport(facts({ sample }));

    expect(report.sample).toMatchObject({ n: 100, p50: 16, p95: 16, p99: 30, max: 40, long_count: 2 });
    expect(report.sample.intervals).toEqual(sample);
  });

  it("u3010e_the_update_stage_holds_the_rendering_update_cost_of_each_sample_frame", async () => {
    const time = clock();
    const done = recordFrames(time.frames, { ...describing, entryTypes: ["event", "paint"] }, async () => true, WINDOWS);

    time.at(evenly(0, 1100, 10));

    const report = await done;

    expect(report.stages.update).toMatchObject({ status: "measured", n: 60, p50: 3, p95: 3, max: 3 });
    expect(report.performance_entry_types).toEqual(["event", "paint"]);
  });

  it("u3010e_a_run_without_updates_leaves_the_update_stage_unmeasured", () => {
    expect(buildReport(facts()).stages.update).toMatchObject({ status: "unmeasured" });
  });

  it("u3010e_the_presentation_reason_names_what_the_webview_offered", () => {
    const reason = (entryTypes: string[]) => {
      const stage = buildReport(facts({ entryTypes })).stages.presentation;

      return stage.status === "unmeasured" ? stage.reason : "";
    };

    expect(reason(["event"])).toContain("Event Timing, which reports trusted input only");
    expect(reason(["paint"])).toContain("no presentation-paced entry type");
  });

  it("u3010e_the_report_names_the_scheduling_stage", () => {
    expect(buildReport(facts()).stages.scheduling).toMatchObject({ status: "measured", meets_thresholds: true });
  });

  it("u3010e_an_unmeasured_stage_is_never_zero_or_a_pass", () => {
    const report = buildReport(facts());

    expect(report.stages.presentation).toMatchObject({ status: "unmeasured" });
    expect(report.stages.presentation).not.toHaveProperty("p95");
    expect(report).toMatchObject({ verdict: "incomplete", exit: 2 });
    expect(buildReport(facts({ sample: Array(600).fill(40) }))).toMatchObject({ verdict: "fail", exit: 1 });
  });

  it("u3010e_a_stalled_or_hidden_run_is_invalid", () => {
    expect(buildReport(facts({ sample: [16, 1500] }))).toMatchObject({ verdict: "invalid", exit: 2 });
    expect(buildReport(facts({ hidden: true })).invalid).toContain("the window was hidden during the run");
    expect(buildReport(facts({ completed: false })).invalid).toContain("the sample ended early");
    expect(buildReport(facts({ actionsDone: false })).invalid).toContain("the workload's actions did not complete");
  });
});

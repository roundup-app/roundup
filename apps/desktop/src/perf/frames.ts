/** Seconds of the `docs/motion.md` Native performance protocol, in ms. */
const PROTOCOL = { warmup: 10_000, sample: 60_000, idle: 30_000 };

export type Windows = typeof PROTOCOL;

/** An interval longer than this means the frame clock stopped. */
const STALL_MS = 1000;

/** The longest interval U3010d's thresholds allow. */
const MAX_INTERVAL_MS = 50;

const REFRESH_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];

export type Series = {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  long_count: number;
  long_rate: number;
  intervals: number[];
};

type Unmeasured = { status: "unmeasured"; reason: string };

const unmeasured = (stage: string): Unmeasured => ({
  status: "unmeasured",
  reason: `the webview exposes no ${stage} timing to a page; only a native instrument can show it`,
});

export type FrameReport = {
  probe: "roundup-frame-recorder";
  workload: string;
  refresh_hz: number;
  period_ms: number;
  engine: "chromium" | "webkit";
  timer_resolution_ms: number;
  user_agent: string;
  sample: Series;
  idle: Series;
  stages: {
    scheduling: { status: "measured"; meets_thresholds: boolean | null };
    style: Unmeasured;
    layout: Unmeasured;
    paint: Unmeasured;
    compositor: Unmeasured;
    presentation: Unmeasured;
  };
  invalid: string[];
  verdict: "fail" | "invalid" | "incomplete";
  exit: 1 | 2;
};

/** Nearest rank, the same rule as `crates/perf`. */
const percentile = (sorted: number[], share: number): number =>
  sorted.length === 0 ? 0 : (sorted[Math.max(Math.ceil(share * sorted.length), 1) - 1] ?? 0);

const series = (intervals: number[], period: number): Series => {
  const sorted = [...intervals].sort((a, b) => a - b);
  const long = intervals.filter((interval) => interval > 1.5 * period).length;

  return {
    n: intervals.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: percentile(sorted, 1),
    long_count: long,
    long_rate: intervals.length === 0 ? 0 : long / intervals.length,
    intervals,
  };
};

export type Facts = {
  workload: string;
  hz: number;
  engine: "chromium" | "webkit";
  timerResolutionMs: number;
  userAgent: string;
  sample: number[];
  idle: number[];
  hidden: boolean;
  completed: boolean;
  actionsDone: boolean;
};

/** What a run proves. Only a valid run is judged, and the webview never measures presentation, so no report here is a pass. */
export const buildReport = (facts: Facts): FrameReport => {
  const period = 1000 / facts.hz;
  const sample = series(facts.sample, period);
  const idle = series(facts.idle, period);

  const invalid = [
    ...(Math.max(...facts.sample, ...facts.idle, 0) > STALL_MS ? ["the frame clock stopped (an interval over 1 s)"] : []),
    ...(facts.hidden ? ["the window was hidden during the run"] : []),
    ...(facts.completed ? [] : ["the sample ended early"]),
    ...(facts.actionsDone ? [] : ["the workload's actions did not complete"]),
    ...(facts.timerResolutionMs > period ? ["the timer resolution is coarser than the refresh period"] : []),
  ];

  const meets = invalid.length > 0 ? null : sample.p95 <= 1.5 * period && sample.p99 <= 3 * period && sample.long_rate <= 0.05 && sample.max <= MAX_INTERVAL_MS;

  return {
    probe: "roundup-frame-recorder",
    workload: facts.workload,
    refresh_hz: facts.hz,
    period_ms: period,
    engine: facts.engine,
    timer_resolution_ms: facts.timerResolutionMs,
    user_agent: facts.userAgent,
    sample,
    idle,
    stages: {
      scheduling: { status: "measured", meets_thresholds: meets },
      style: unmeasured("style"),
      layout: unmeasured("layout"),
      paint: unmeasured("paint"),
      compositor: unmeasured("compositor"),
      presentation: unmeasured("presentation"),
    },
    invalid,
    verdict: invalid.length > 0 ? "invalid" : meets ? "incomplete" : "fail",
    exit: invalid.length === 0 && !meets ? 1 : 2,
  };
};

/** The nearest standard refresh rate to the median warm-up interval. */
const refreshHz = (warmup: number[]): number => {
  const median = percentile([...warmup].sort((a, b) => a - b), 0.5);
  const rate = median > 0 ? 1000 / median : 60;

  return REFRESH_RATES.reduce((best, hz) => (Math.abs(hz - rate) < Math.abs(best - rate) ? hz : best));
};

/** What the run needs from its surroundings: the browser supplies the DOM, tests a fake frame clock. */
export type Frames = {
  /** Calls back with the frame's timestamp, as `requestAnimationFrame` does. */
  frame(callback: (at: number) => void): void;
  hidden(): boolean;
};

/**
 * One workload's run: ignores the warm-up, records every frame interval of the sample window, then of the idle window, and stops.
 * Nothing is recorded outside a run, and `actions` runs only during the sample window.
 */
export const recordFrames = (
  frames: Frames,
  describe: Pick<Facts, "workload" | "engine" | "timerResolutionMs" | "userAgent">,
  actions: () => Promise<boolean>,
  windows: Windows = PROTOCOL,
): Promise<FrameReport> =>
  new Promise((resolve) => {
    const warmup: number[] = [];
    const sample: number[] = [];
    const idle: number[] = [];
    let start: number | null = null;
    let previous: number | null = null;
    let hidden = false;
    let actionsDone = false;
    let began = false;

    const finish = (completed: boolean) =>
      resolve(buildReport({ ...describe, hz: refreshHz(warmup), sample, idle, hidden, completed, actionsDone }));

    const tick = (at: number) => {
      start ??= at;

      hidden ||= frames.hidden();

      const into = at - start;
      const interval = previous === null ? null : at - previous;

      previous = at;

      if (into >= windows.warmup + windows.sample + windows.idle) return finish(true);

      if (interval !== null) {
        if (into < windows.warmup) warmup.push(interval);
        else if (into < windows.warmup + windows.sample) sample.push(interval);
        else idle.push(interval);
      }

      if (into >= windows.warmup && !began) {
        began = true;
        void actions().then((done) => (actionsDone = done));
      }

      frames.frame(tick);
    };

    frames.frame(tick);
  });

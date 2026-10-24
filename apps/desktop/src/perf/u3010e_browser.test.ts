import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import type { FrameReport } from "./frames";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U3010e needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

run("u3010e the recorder in the Chromium harness", () => {
  it("u3010e_the_chromium_harness_produces_a_valid_scheduling_report", async () => {
    await page.load("/harness.html?seed=tree-40", 1280, 820);
    await page.until(`() => Boolean(document.querySelector('.window'))`);

    const report = await page.call<FrameReport>(`async () => {
      const { recordFrames } = await import('/src/perf/frames.ts');
      return recordFrames(
        { frame: (callback) => void requestAnimationFrame(callback), hidden: () => document.hidden, after: (ms, callback) => void setTimeout(callback, ms) },
        { workload: 'glyphs', engine: 'chromium', timerResolutionMs: 0.1, userAgent: navigator.userAgent },
        async () => true,
        { warmup: 200, sample: 800, idle: 400 },
      );
    }`);

    expect(report.invalid).toEqual([]);
    expect(report.sample.n).toBeGreaterThan(0);
    expect(report.stages.scheduling.status).toBe("measured");
    expect(report.stages.presentation.status).toBe("unmeasured");
    expect(report).toMatchObject({ engine: "chromium", exit: 2 });
  }, 30_000);
});

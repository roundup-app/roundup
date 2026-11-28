import { chromium, webkit, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";
import { chromePath } from "../testing/chromePage";

let server: AppServer;

beforeAll(async () => {
  server = await appServer();
}, 90_000);

afterAll(async () => {
  await server?.close();
});

/** U7610d: ten fresh pages in a row, so one check run holds the ten-run margin. */
const RUNS = 10;

/** The longest stretch the page's main thread ran without yielding while Changes opened on the big file, in a fresh page. */
const longestBlock = async (engine: Browser, query = "dense") => {
  const context = await engine.newContext();

  try {
    const page = await context.newPage();

    await page.goto(new URL(`/src/changes/u2540.html?${query}`, server.resolvedUrls.local[0]).href);
    // The lazy diff chunk loads and evaluates once at startup (R3800), not per open; the beat measures the list.
    // A string, so vitest does not rewrite the page's native import().
    await page.evaluate(`(async () => {
      const chunks = await import("/src/changes/chunks.ts");

      await chunks.loadReader();
    })()`);
    await page.evaluate(() => {
      window.__fake.app.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: "/p", checkout: "/p", branch: "main", base: "main", files: [{ path: "a.ts", status: "modified", line: 1, counts: { added: 10000, removed: 10000 }, blob: null }] }] });
      window.__fake.setStatus("agent-1", "idle", "idle");
    });

    // A first open pays the engine's one-time style, layout and JIT warm-up for the view; open and close it once so the beat measures an open.
    await page.click(".changes-icon");
    await page.waitForSelector(".changes-side .changes-tree [data-row]");
    await page.getByRole("button", { name: "Close changes" }).click();
    await page.waitForSelector(".changes-side", { state: "detached" });
    await page.waitForTimeout(1000);

    const beat = await page.evaluateHandle(() => {
      const gaps = { longest: 0 };
      let last = performance.now();

      setInterval(() => {
        const now = performance.now();

        gaps.longest = Math.max(gaps.longest, now - last - 10);
        last = now;
      }, 10);

      return gaps;
    });

    await page.click(".changes-icon");
    await page.waitForSelector(".changes-side .changes-tree [data-row]");
    // U8010a: the view opens on the big file's code with no click, and U8005a folds the Rail and the Bench as it opens; the beat spans the slide and the whole draw.
    await page.waitForTimeout(1000);

    return await beat.evaluate(gaps => gaps.longest);
  } finally {
    await context.close();
  }
};

it.each([["Chromium", chromium], ["WebKit", webkit]] as const)("u7610b_a_ten_thousand_line_rewrite_keeps_the_page_responsive (%s)", async (_name, type) => {
  const executablePath = type === chromium ? chromePath() : undefined;
  const engine: Browser = await (executablePath === undefined ? type.launch() : type.launch({ executablePath }));

  try {
    const longest: number[] = [];

    for (let run = 0; run < RUNS; run++) longest.push(await longestBlock(engine));

    expect(Math.max(...longest)).toBeLessThan(200);
  } finally {
    await engine.close();
  }
}, 300_000);

/** U8075: the open with motion on, in milliseconds from the click. */
const slideOf = async (engine: Browser) => {
  const context = await engine.newContext();

  try {
    const page = await context.newPage();

    await page.goto(new URL("/src/changes/u2540.html?dense&motion", server.resolvedUrls.local[0]).href);
    await page.evaluate(`(async () => { await (await import("/src/changes/chunks.ts")).loadReader(); })()`);
    await page.evaluate(() => {
      window.__fake.app.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: "/p", checkout: "/p", branch: "main", base: "main", files: [{ path: "a.ts", status: "modified", line: 1, counts: { added: 10000, removed: 10000 }, blob: null }] }] });
      window.__fake.setStatus("agent-1", "idle", "idle");
    });
    await page.click(".changes-icon");
    await page.waitForSelector(".changes-side .changes-tree [data-row]");
    await page.getByRole("button", { name: "Close changes" }).click();
    await page.waitForSelector(".changes-side", { state: "detached" });
    await page.waitForTimeout(1000);

    return await page.evaluate(() => new Promise<{ first: number; end: number; draw: number; block: number; duration: string }>(resolve => {
      const body = () => document.querySelector<HTMLElement>(".rail-body");
      const result = { first: -1, end: -1, draw: -1, block: 0, duration: "" };
      const blocks: { at: number; length: number }[] = [];
      let start = 0;

      const note = (entries: PerformanceEntryList) => { for (const entry of entries) blocks.push({ at: entry.startTime - start, length: entry.duration }); };

      const tasks = new PerformanceObserver(list => note(list.getEntries()));

      tasks.observe({ type: "longtask" });
      new MutationObserver(() => { if (result.draw < 0 && document.querySelector("diffs-container")) result.draw = performance.now() - start; }).observe(document.body, { childList: true, subtree: true });

      const watch = () => {
        const element = body();

        // The compositor runs the slide from the frame that starts it, so that frame is the first one drawn, whatever the main thread does next.
        if (result.first < 0 && element?.getAnimations().some(animation => animation instanceof CSSTransition && animation.transitionProperty === "transform")) result.first = performance.now() - start;

        if (result.first < 0 || result.end < 0) requestAnimationFrame(watch);
      };

      start = performance.now();
      document.querySelector<HTMLElement>(".changes-icon")?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      requestAnimationFrame(watch);
      requestAnimationFrame(() => requestAnimationFrame(async () => {
        const slides = document.getAnimations().filter(animation => animation instanceof CSSTransition && animation.transitionProperty === "transform");

        result.duration = slides.map(slide => String(slide.effect?.getTiming().duration)).join(",");
        await Promise.allSettled(slides.map(slide => slide.finished));
        result.end = performance.now() - start;
        setTimeout(() => {
          note(tasks.takeRecords());
          result.block = Math.max(0, ...blocks.flatMap(block => block.at < result.end ? [block.length] : []));
          resolve(result);
        }, 50);
      }));
    }));
  } finally {
    await context.close();
  }
};

it("u7610b_responsive_webkit u8075 the fold slides at once, draws before it ends and takes the layout duration (Chromium)", async () => {
  const executablePath = chromePath();
  const engine = await (executablePath === undefined ? chromium.launch() : chromium.launch({ executablePath }));

  try {
    const run = await slideOf(engine);

    expect(run.first).toBeGreaterThanOrEqual(0);
    expect(run.first).toBeLessThanOrEqual(50);
    expect(run.block).toBeLessThan(100);
    expect(run.draw).toBeGreaterThanOrEqual(0);
    expect(run.draw).toBeLessThan(run.end);
    expect(run.duration.split(",").every(duration => duration === "200")).toBe(true);
  } finally {
    await engine.close();
  }
}, 120_000);

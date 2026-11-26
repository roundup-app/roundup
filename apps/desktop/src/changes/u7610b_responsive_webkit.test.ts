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

/** The longest stretch the page's main thread ran without yielding while the Changes list opened, in a fresh page. */
const longestBlock = async (engine: Browser) => {
  const context = await engine.newContext();

  try {
    const page = await context.newPage();

    await page.goto(new URL("/src/changes/u2540.html?dense", server.resolvedUrls.local[0]).href);
    // The lazy diff chunk loads and evaluates once at startup (R3800), not per open; the beat measures the list.
    // A string, so vitest does not rewrite the page's native import().
    await page.evaluate(`(async () => {
      const chunks = await import("/src/changes/chunks.ts");

      await chunks.loadReader();
    })()`);
    await page.evaluate(() => {
      window.__fake.app.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: "/p", branch: "main", base: "main", files: [{ path: "a.ts", status: "modified", line: 1, counts: { added: 10000, removed: 10000 }, blob: null }] }] });
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
    // The view opens on the Overview and draws no diff (U7679c): the beat chooses the module that holds the big file.
    await page.click('.changes-side .changes-tree [data-row="module"]');
    await page.waitForTimeout(500);

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

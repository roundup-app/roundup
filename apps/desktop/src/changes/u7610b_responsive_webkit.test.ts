import { chromium, webkit, type Browser, type BrowserType } from "playwright";
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

/** The longest stretch the page's main thread ran without yielding while the Changes list opened. */
const longestBlock = async (type: BrowserType) => {
  const executablePath = type === chromium ? chromePath() : undefined;
  const engine: Browser = await (executablePath === undefined ? type.launch() : type.launch({ executablePath }));

  try {
    const page = await engine.newPage();

    await page.goto(new URL("/src/changes/u2540.html?dense", server.resolvedUrls.local[0]).href);
    await page.evaluate(() => {
      window.__fake.app.handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: "/p", branch: "main", base: "main", files: [{ path: "a.ts", status: "modified", line: 1, counts: { added: 10000, removed: 10000 } }] }] });
      window.__fake.setStatus("agent-1", "idle", "idle");
    });

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
    await page.waitForSelector(".changes-files li");
    await page.waitForTimeout(500);

    return await beat.evaluate(gaps => gaps.longest);
  } finally {
    await engine.close();
  }
};

it.each([["Chromium", chromium], ["WebKit", webkit]] as const)("u7610b_a_ten_thousand_line_rewrite_keeps_the_page_responsive (%s)", async (_name, type) => {
  expect(await longestBlock(type)).toBeLessThan(200);
}, 60_000);

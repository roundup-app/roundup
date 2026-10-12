import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";

/** U59's observer: ten Agents on the real `rupd` and a real Chromium; the selected Terminal passes D1, D6, D7 and D10. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U59 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon({}, true);
  page = await openPage(found);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

type Checks = Record<string, { status: string; selector: string }>;

/** A cold dev server may reload the page once it has bundled its dependencies, or a loaded runner may stall it, so the page is loaded again when the rail has not come up. */
const openHarness = async () => {
  for (let attempt = 1; ; attempt += 1) {
    await page.load(`${real.base}/harness.html?daemon=1`, 1280, 800);

    try {
      await page.until(`() => Boolean(document.querySelector(".rail-actions button"))`, 20_000);

      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
};

run("u59 on the real Daemon", () => {
  vi.setConfig({ testTimeout: 120_000 });

  it("u59_ten_agents_on_the_real_daemon_leave_d1_d6_d7_and_d10_clean", async () => {
    await openHarness();
    await page.call(`() => [...document.querySelectorAll("button")].find((each) => (each.getAttribute("aria-label") === "Add Workstream" || each.textContent.includes("New Workstream"))).click()`);

    for (let count = 1; count <= 10; count += 1) {
      await page.until(`() => [...document.querySelectorAll("button[data-button=icon]")].find((each) => each.getAttribute("aria-label") === "Add Agent")?.getAttribute("aria-disabled") !== "true" && Boolean([...document.querySelectorAll("button[data-button=icon]")].find((each) => each.getAttribute("aria-label") === "Add Agent"))`);
      await page.call(`() => [...document.querySelectorAll("button[data-button=icon]")].find((each) => each.getAttribute("aria-label") === "Add Agent").click()`);
      await page.until(`() => document.querySelectorAll('.rail [role="treeitem"]:not([data-button])').length >= ${count + 1}`);
    }

    await page.until(`() => Boolean(document.querySelector(".xterm-scrollable-element")) && Boolean(document.querySelector("textarea.xterm-helper-textarea"))`);

    const checks = await page.call<Checks>(`() => window.__checks()`);

    expect(["D1", "D6", "D7", "D10"].map((id) => [id, checks[id]!.status, checks[id]!.selector])).toEqual([["D1", "pass", ""], ["D6", "pass", ""], ["D7", "pass", ""], ["D10", "pass", ""]]);
  });
});

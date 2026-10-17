import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U387: focus inside a row shows its row action, in Chromium. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U387 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const ROW = `document.querySelector('.rail-row[data-id="backend"]')`;

const DOOR = `([...${ROW}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start supervisor') ?? null)`;

run("u387 focus inside a row shows its row action", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const [width, height] of [[1280, 800]] as const) {
    it(`u387_focus_on_collapse_shows_start_door at ${width}x${height}`, async () => {
      await page.load("/harness.html?seed=tree-40", width, height);
      await page.until(`() => Boolean(window.__fake) && ${ROW} !== null`);
      await page.hover(width - 2, height - 2);

      const before = await page.call<{ w: number; h: number }>(
        `() => { const r = ${ROW}.getBoundingClientRect(); return { w: r.width, h: r.height }; }`,
      );

      await page.call(`() => ${ROW}.querySelector('button[aria-label=Collapse]').focus()`);
      await page.until(`() => ${DOOR} !== null`);

      const shown = await page.call<{ w: number; h: number; hit: number }>(
        `() => { const r = ${ROW}.getBoundingClientRect(); const b = ${DOOR}.getBoundingClientRect(); return { w: r.width, h: r.height, hit: b.height }; }`,
      );

      expect(shown.hit).toBeGreaterThanOrEqual(24);
      expect(shown.w).toBe(before.w);
      expect(shown.h).toBe(before.h);

      // Add Agent precedes the Door action.
      await page.press("Tab", "Tab");
      await page.press("Tab", "Tab");
      expect(await page.call<boolean>(
        `() => document.activeElement === ${DOOR}`,
      )).toBe(true);

      await page.call(`() => document.activeElement.blur()`);
      await page.until(`() => ${DOOR} === null`);
    });
  }
});

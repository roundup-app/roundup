import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U393: showing or hiding the Live line moves no row. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U393 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const BOXES = `() => [...document.querySelectorAll(".rail-row")].map((row) => { const box = row.getBoundingClientRect(); return [row.dataset.id, box.height, box.width]; })`;

type Box = [string, number, number];

run("u393 the Live line moves no row", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const [width, height] of [[1280, 800], [700, 800]] as const) {
    it(`u393_row_height_unmoved at ${width}x${height}`, async () => {
      await page.load("/harness.html?seed=agents-10", width, height);
      await page.until(`() => Boolean(window.__fake) && document.querySelector(".rail-row .line") !== null`);
      const hidden = await page.call<Box[]>(BOXES);

      await page.call(`() => document.querySelector('.rail-row:not([aria-expanded])').click()`);
      await page.until(`() => document.querySelector('.rail-row:not([aria-expanded]) .live') !== null`);
      const shown = await page.call<Box[]>(BOXES);

      expect(hidden.length).toBeGreaterThan(0);
      expect(shown.map(([, h]) => h)).toEqual(hidden.map(([, h]) => h));
    });
  }
});

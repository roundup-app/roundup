import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U387 in a real Chromium: jsdom has no layout, so the action's hit height and the row's box are read rendered. */

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

const ROW = `[...document.querySelectorAll('.rail-row')].find((row) => row.querySelector('[aria-label=collapse]'))`;

const BOX = `() => { const r = (${ROW}).getBoundingClientRect(); return [r.width, r.height]; }`;

const FOCUS = `() => { (${ROW}).querySelector('[aria-label=collapse]').focus(); return true; }`;

const HIT = `() => { const b = [...(${ROW}).querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'start Door' || el.textContent.trim() === 'start Door'); return b ? b.getBoundingClientRect().height : 0; }`;

run("u387 focus inside a row, read in Chromium", () => {
  for (const [width, height] of [[1280, 800], [700, 800]] as const) {
    it(`u387_focus_on_collapse_shows_start_door at ${width}x${height}`, async () => {
      await page.load("/harness.html?seed=door-stopped", width, height);
      await page.until(`() => Boolean(${ROW})`, 60_000);
      await page.call(FOCUS);

      expect(await page.call<number>(HIT), "start Door's hit height in px").toBeGreaterThanOrEqual(24);
    });

    it(`u387_the_row_does_not_resize at ${width}x${height}`, async () => {
      await page.load("/harness.html?seed=tree-40", width, height);
      await page.until(`() => Boolean(${ROW})`, 60_000);
      await page.call(`() => { document.activeElement?.blur(); return true; }`);

      const before = await page.call<number[]>(BOX);

      await page.call(FOCUS);

      expect(await page.call<number[]>(BOX)).toEqual(before);
    });
  }
});

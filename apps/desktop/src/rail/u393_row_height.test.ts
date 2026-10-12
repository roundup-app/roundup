import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U393's Label clause in a real Chromium: showing the Live line (a row near the pointer) moves no row. */

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

const BOXES = `() => [...document.querySelectorAll('.rail [role="treeitem"]:not([data-button])')].map((row) => { const box = row.getBoundingClientRect(); return [Math.round(box.top * 100), Math.round(box.height * 100)]; })`;

const LIVE = `() => document.querySelectorAll(".rail-row .live").length`;

const CENTRES = `() => [...document.querySelectorAll('.rail [role="treeitem"]:not([data-button])')].map((row) => { const box = row.getBoundingClientRect(); return [box.left + box.width / 2, box.top + box.height / 2]; })`;

run("u393 in Chromium", () => {
  it("u393_row_height_unmoved", async () => {
    await page.load("/harness.html?seed=agents-10", 1280, 800);
    await page.until(`() => document.querySelectorAll('.rail [role="treeitem"]').length >= 10`, 60_000);
    await page.hover(1, 1);

    const before = await page.call<number[][]>(BOXES);
    const live = await page.call<number>(LIVE);
    const centres = await page.call<number[][]>(CENTRES);
    const shown: number[] = [];
    const moved: number[][][] = [];

    for (const [x, y] of centres) {
      await page.hover(x!, y!);
      shown.push(await page.call<number>(LIVE));
      moved.push(await page.call<number[][]>(BOXES));
    }

    expect(Math.max(...shown)).toBeGreaterThan(live);
    expect(moved.filter((boxes) => JSON.stringify(boxes) !== JSON.stringify(before))).toEqual([]);
  }, 120_000);
});

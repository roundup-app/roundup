// oxlint-disable anti-slop/no-new-web-assertions
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const found = chromePath();

const run = found || process.env.CI ? it : it.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U6640c needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); }, 60_000);

run("u6640c_a_tooltip_box_clears_the_row_below_its_target", async () => {
  await page.scheme("dark");
  await page.load("/harness.html?seed=tree-40", 1512, 950);
  await page.until(`() => Boolean(window.__fake) && document.querySelectorAll('.rail-row').length > 1`);

  const target = await page.call<{ x: number; y: number }>(`() => {
    const rows = [...document.querySelectorAll('.rail-row')];
    const row = rows.find((r, i) => i < rows.length - 1 && r.querySelector('button[data-button="icon"]'));
    row.dataset.u6640c = "target";
    rows[rows.indexOf(row) + 1].dataset.u6640c = "below";
    const b = row.querySelector('button[data-button="icon"]').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }`);

  await page.hover(target.x, target.y);
  await page.until(`() => document.querySelector('[data-scope="tooltip"][data-part="content"]')`);

  const overlap = await page.call<boolean>(`() => {
    const t = document.querySelector('[data-scope="tooltip"][data-part="content"]').getBoundingClientRect();
    const b = document.querySelector('[data-u6640c="below"]').getBoundingClientRect();
    return t.left < b.right && t.right > b.left && t.top < b.bottom && t.bottom > b.top;
  }`);

  expect(overlap).toBe(false);
}, 60_000);

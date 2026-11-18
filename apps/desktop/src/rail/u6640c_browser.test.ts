// oxlint-disable anti-slop/no-new-web-assertions
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import { copy } from "./copy";
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

  // U7413a: a universal icon (the fold chevron, stop, more) shows no name, so the target is a row's Start Door button.
  const target = await page.call<{ row: { x: number; y: number }; icon: { x: number; y: number } }>(`(label) => {
    const rows = [...document.querySelectorAll('.rail-row')];
    const button = (r) => r.querySelector('.row-icons button[aria-label="' + label + '"]');
    const row = rows.find((r, i) => i < rows.length - 1 && button(r));
    row.dataset.u6640c = "target";
    rows[rows.indexOf(row) + 1].dataset.u6640c = "below";
    const r = row.getBoundingClientRect();
    const b = button(row).getBoundingClientRect();
    return { row: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, icon: { x: b.left + b.width / 2, y: b.top + b.height / 2 } };
  }`, copy.startDoor);

  // A row's icons take the pointer only once the row is hovered.
  await page.hover(target.row.x, target.row.y);
  await page.until(`() => getComputedStyle(document.querySelector('[data-u6640c="target"] .row-icons')).pointerEvents === 'auto'`);
  await page.hover(target.icon.x, target.icon.y);
  await page.until(`() => document.querySelector('[data-slot="tooltip-content"][data-open]')`);

  const overlap = await page.call<boolean>(`() => {
    const t = document.querySelector('[data-slot="tooltip-content"][data-open]').getBoundingClientRect();
    const b = document.querySelector('[data-u6640c="below"]').getBoundingClientRect();
    return t.left < b.right && t.right > b.left && t.top < b.bottom && t.bottom > b.top;
  }`);

  expect(overlap).toBe(false);
}, 60_000);

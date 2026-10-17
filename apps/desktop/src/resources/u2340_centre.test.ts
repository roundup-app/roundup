import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2340 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

type Box = { l: number; r: number; t: number; b: number; w: number; h: number };

const BOXES = `() => {
  const box = selector => { const e = document.querySelector(selector); if (!e) return null; const r = e.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}; };
  return {centre:box('.centre'), pane:box('.pane'), bar:box('.resource-strip'), show:box('[aria-label="Show work items"]'), failure:box('.pane-failure'), body:box('.pane-body'),
    space2:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-2')), space5:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-5'))};
}`;

type Boxes = { centre: Box; pane: Box; bar: Box; show: Box | null; failure: Box; body: Box; space2: number; space5: number };

const open = async (): Promise<void> => {
  await page.load("/harness.html?seed=resources", 1512, 950);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => { if (!document.querySelector('.content-actions [aria-label="Show work items"]')) document.querySelector('[aria-label="Hide work items"]')?.click(); document.querySelector('[data-id="worktree-agent"]').click(); }`);
  await page.until(`() => document.querySelector('.resource-agent .resource-num') && document.querySelector('[aria-label="Show work items"]')`);
};

it("u2340a_the_terminal_and_bar_sit_one_space_from_the_centre_edges", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);
    await open();
    const { centre, pane, bar, space2 } = await page.call<Boxes>(BOXES);

    for (const box of [pane, bar]) {
      expect(box.l).toBeCloseTo(centre.l + space2, 0);
      expect(box.w).toBeCloseTo(centre.w - 2 * space2, 0);
    }
  }
}, 120_000);

it("u2340a_the_show_button_floats_at_the_terminals_corner", async () => {
  await open();
  const { pane, bar, show, space2 } = await page.call<Boxes>(BOXES);

  expect(show).not.toBeNull();
  expect(show!.t).toBeCloseTo(pane.t, 0);
  expect(show!.r).toBeCloseTo(pane.r - space2, 0);
  expect(show!.l).toBeGreaterThanOrEqual(pane.l);
  expect(show!.b).toBeLessThanOrEqual(pane.b);
  expect(Math.abs(pane.r - bar.r)).toBeLessThanOrEqual(1);
  expect(Math.abs(pane.l - bar.l)).toBeLessThanOrEqual(1);
}, 60_000);

it("u2340b_no_failure_takes_no_height", async () => {
  await open();
  expect((await page.call<Boxes>(BOXES)).failure.h).toBe(0);
}, 60_000);

it("u2340c_the_bar_is_one_line_the_terminals_width", async () => {
  await open();
  const { pane, bar, space2, space5 } = await page.call<Boxes>(BOXES);

  expect(bar.w).toBeCloseTo(pane.w, 0);
  expect(bar.h).toBeCloseTo(space5, 0);
  expect(await page.call<number>(`() => parseFloat(getComputedStyle(document.querySelector('.resource-strip')).paddingLeft)`)).toBe(space2);
}, 60_000);

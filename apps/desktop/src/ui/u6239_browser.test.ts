import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U6239 needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); }, 60_000);

// The strip fades its first tab under a cut, so the drags below start at the first fully visible tab.
const tabs = ".app-tabs-list .project-tab";

/** The strip scrolls to the selected tab, so the nth tab counted is the nth one fully on screen. */
const centre = (n: number) => page.call<{ x: number; y: number }>(`(tabs, n) => {
  const b = [...document.querySelectorAll(tabs)].map(t => t.getBoundingClientRect()).filter(b => b.left >= 100)[n];
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, tabs, n);

const order = () => page.call<string[]>(`tabs => [...document.querySelectorAll(tabs)].map(t => t.dataset.path)`, tabs);

const onScreen = (n: number) => page.call<string>(`(tabs, n) => [...document.querySelectorAll(tabs)].filter(t => t.getBoundingClientRect().left >= 100)[n].dataset.path`, tabs, n);

/** Whether the lifted tab's box holds the pointer, and how many slots the strip holds. dnd-kit gives the lifted element `pointer-events: none`, so `elementFromPoint` never names it. */
const hit = (x: number, y: number, lifted: string) => page.call<{ lifted: boolean; slots: number }>(`(x, y, lifted) => {
  const b = [...document.querySelectorAll('.app-tabs-list .project-tab')].find(t => t.dataset.path === lifted).getBoundingClientRect();
  return { lifted: x >= b.left && x <= b.right && y >= b.top && y <= b.bottom, slots: document.querySelectorAll('.app-tabs-list .sortable-slot').length };
}`, x, y, lifted);

run("u6239 Project tab drag", () => {
  it("u6239a_the_held_tab_is_under_the_pointer", async () => {
    await page.scheme("dark");
    await page.load("/harness.html?seed=tabs-8", 1512, 950);
    await page.until(`() => document.querySelectorAll('.app-tabs-list .project-tab').length >= 6`);
    // The strip scrolls the selected tab into view before the drag measures it.
    await new Promise(resolve => setTimeout(resolve, 1000));

    const from = await centre(0);
    const lifted = await onScreen(0);
    const to = await centre(3);

    await page.pointer("down", from.x, from.y);
    await page.pointer("move", from.x + 6, from.y);

    for (let step = 1; step <= 10; step++) {
      const x = from.x + 6 + ((to.x - from.x) * step) / 10;

      await page.pointer("move", x, from.y);
      await page.call(`() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      // U6239a explicitly commissions this one pointer-hit guard (#6239).
      // oxlint-disable-next-line anti-slop/no-new-web-assertions
      expect(await hit(x, from.y, lifted)).toEqual({ lifted: true, slots: 0 });
    }

    await page.pointer("up", to.x, from.y);
  }, 60_000);

  it("u6239b_holding_still_moves_nothing", async () => {
    await page.load("/harness.html?seed=tabs-8", 1512, 950);
    await page.until(`() => document.querySelectorAll('.app-tabs-list .project-tab').length >= 6`);
    // The strip scrolls the selected tab into view before the drag measures it.
    await new Promise(resolve => setTimeout(resolve, 1000));

    const from = await centre(0);
    const next = await centre(1);
    const before = await order();
    const liftedAt = before.indexOf(await onScreen(0));

    await page.pointer("down", from.x, from.y);
    await page.pointer("move", from.x + 6, from.y);

    // Past the neighbour's middle, so the library has swapped them once.
    const x = next.x + 12;

    for (let step = 1; step <= 8; step++) await page.pointer("move", from.x + ((x - from.x) * step) / 8, from.y);
    await new Promise(resolve => setTimeout(resolve, 150));

    const seen = [await page.call<string>(`() => document.querySelector('.app-tabs-list').dataset.sortableIndex`), ...(await order())];

    await new Promise(resolve => setTimeout(resolve, 500));
    expect([await page.call<string>(`() => document.querySelector('.app-tabs-list').dataset.sortableIndex`), ...(await order())]).toEqual(seen);
    expect(seen[0]).toBe(String(liftedAt + 1));
    await page.pointer("up", x, from.y);
  }, 60_000);
  it("u6239d_a_clipped_tab_follows_and_reorders", async () => {
    // Narrow enough that the strip overflows whatever else the window bar holds.
    await page.load("/harness.html?seed=tabs-8", 1000, 950);
    await page.until(`() => document.querySelectorAll('.app-tabs-list .project-tab').length >= 6`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Scroll the strip so the furthest tab the overflow can reach is cut by the start edge, and grab it by the part still showing.
    const index = await page.call<number>(`() => {
      const list = document.querySelector('.app-tabs-list');
      const offsets = [...list.querySelectorAll('.project-tab')].map(tab => tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft);
      const index = offsets.findLastIndex(offset => offset + 30 <= list.scrollWidth - list.clientWidth);

      list.scrollLeft = offsets[index] + 30;

      return index;
    }`);

    await new Promise(resolve => setTimeout(resolve, 600));

    const grabbed = await page.call<{ path: string; x: number; y: number; cut: boolean }>(`index => {
      const list = document.querySelector('.app-tabs-list');
      const edge = list.getBoundingClientRect().left;
      const target = list.querySelectorAll('.project-tab')[index];
      const b = target.getBoundingClientRect();
      return { path: target.dataset.path, x: edge + 20, y: b.top + b.height / 2, cut: b.left < edge };
    }`, index);

    if (!grabbed.cut) throw new Error("the tab is not cut by the strip's start");
    const before = await order();
    const saved = () => page.call<string | null>(`() => localStorage.getItem('roundup:tab-order')`);
    const savedBefore = await saved();
    const width = await page.call<number>(`path => [...document.querySelectorAll('.app-tabs-list .project-tab')].find(t => t.dataset.path === path).getBoundingClientRect().width`, grabbed.path);
    const target = grabbed.x + width * 2;

    await page.pointer("down", grabbed.x, grabbed.y);
    await page.pointer("move", grabbed.x + 6, grabbed.y);

    for (let step = 1; step <= 10; step++) {
      const x = grabbed.x + 6 + ((target - grabbed.x) * step) / 10;

      await page.pointer("move", x, grabbed.y);
      await page.call(`() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      // U6239d extends U6239a's pointer-hit guard to a clipped tab.
      // oxlint-disable-next-line anti-slop/no-new-web-assertions
      expect(await hit(x, grabbed.y, grabbed.path)).toEqual({ lifted: true, slots: 0 });
    }

    await page.pointer("up", target, grabbed.y);
    await new Promise(resolve => setTimeout(resolve, 600));
    const after = await order();

    expect(after).not.toEqual(before);
    expect(await saved()).not.toEqual(savedBefore);
  }, 60_000);
});

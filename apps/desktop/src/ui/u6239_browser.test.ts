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

  /** The centre of the first grip `selector` names that a press there would hit, or null while none shows. */
  const grip = (selector: string) => `() => {
    for (const handle of document.querySelectorAll(${JSON.stringify(selector)})) {
      const b = handle.getBoundingClientRect();
      const at = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      if (b.width > 0 && document.elementFromPoint(at.x, at.y)?.closest('.sortable-handle') === handle) return at;
    }
    return null;
  }`;

  /** Press that grip (a row drags only from its grip), move it over the next row and read what paints the held element: its ground's alpha and whether it sits in the top layer, above every row. */
  const held = async (selector: string, onRail = false) => {
    const from = await page.call<{ x: number; y: number }>(grip(selector));

    await page.pointer("down", from.x, from.y);
    await page.pointer("move", from.x + 6, from.y + 6);
    await page.pointer("move", from.x + 10, from.y + 24);
    await page.until(`() => Boolean(document.querySelector('[data-dnd-dragging]'))`);

    const seen = await page.call<{ opaque: boolean; top: boolean; rail: boolean }>(`() => {
      const el = document.querySelector('[data-dnd-dragging]');
      const ground = getComputedStyle(el).backgroundColor;
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--rail-ground)';
      document.body.append(probe);
      const rail = !${onRail} || getComputedStyle(probe).backgroundColor === ground;
      probe.remove();
      return { opaque: !ground.includes('/') && !ground.startsWith('rgba') && ground !== 'transparent', top: el.matches(':popover-open'), rail };
    }`);

    await page.pointer("up", from.x + 10, from.y + 24);

    return seen;
  };

  it("u6554a_held_tab_is_opaque_and_on_top", async () => {
    await page.scheme("dark");
    await page.load("/harness.html?seed=tabs-8", 1512, 950);
    await page.until(`() => document.querySelectorAll('.app-tabs-list .project-tab').length >= 6`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const from = await centre(0);
    const next = await centre(1);

    await page.pointer("down", from.x, from.y);
    await page.pointer("move", from.x + 6, from.y);
    await page.pointer("move", (from.x + next.x) / 2 + 6, from.y);
    await page.until(`() => Boolean(document.querySelector('.project-tab[data-dnd-dragging]'))`);
    // U6554a explicitly commissions this one painting guard (#6554).
    // oxlint-disable-next-line anti-slop/no-new-web-assertions
    expect(await page.call(`() => {
      const el = document.querySelector('.project-tab[data-dnd-dragging]');
      const ground = getComputedStyle(el).backgroundColor;
      return { opaque: !ground.includes('/') && !ground.startsWith('rgba') && ground !== 'transparent', top: el.matches(':popover-open') };
    }`)).toEqual({ opaque: true, top: true });
    await page.pointer("up", (from.x + next.x) / 2 + 6, from.y);
  }, 60_000);

  /** Opens the Shelf tab `tab` names. */
  const shelfTab = async (tab: string) => {
    await page.until(`() => Boolean(document.querySelector('#shelf-tab-${tab}'))`);
    await page.call(`() => {
      const control = document.querySelector('#shelf-tab-${tab}');
      if (control.getAttribute('aria-expanded') !== 'true') control.click();
      return null;
    }`);
  };

  /** Opens the Todos tab and unfolds its closed groups, so its rows show. */
  const todos = async () => {
    await shelfTab("todos");
    await page.until(`() => Boolean(document.querySelector('.shelf [data-part="branch-control"]'))`);
    await page.call(`() => {
      for (const branch of document.querySelectorAll('.shelf [data-part="branch-control"][data-state="closed"]')) branch.click();
      return null;
    }`);
  };

  // The Rail and the Shelf sit on `--rail-ground`; a Todo and a Pad are the Shelf's rows, and the shelf case holds the Shelf's own rule.
  const shelfUrl = "/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40";

  for (const [surface, url, open, selector, rail] of [
    ["rail", "/harness.html?seed=tree-40", async () => {}, ".rail .rail-row .sortable-handle", true],
    ["todo", shelfUrl, todos, ".shelf .todo-row .sortable-handle", null],
    ["pad", shelfUrl, () => shelfTab("pads"), ".shelf .pad-row-head .sortable-handle", null],
    ["shelf", shelfUrl, todos, ".shelf .sortable-handle", true],
  ] as const) {
    it(`u6554b_every_held_row_is_opaque_and_on_top_${surface}`, async () => {
      await page.scheme("dark");
      await page.load(url, 1512, 950);
      await open();
      await page.until(grip(selector));
      // U6554b explicitly commissions this one painting guard (#6554).
      // oxlint-disable-next-line anti-slop/no-new-web-assertions
      expect(await held(selector, rail)).toEqual({ opaque: true, top: true, rail: true });
    }, 60_000);
  }

});

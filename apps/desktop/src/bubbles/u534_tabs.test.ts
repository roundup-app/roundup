import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => { page = await openPage(chromePath()!); }, 90_000);
afterAll(async () => { await page?.close(); });

const eight = async (width: number, scheme: "light" | "dark", runs = 8): Promise<void> => {
  await page.scheme(scheme);
  await page.load("/harness.html?seed=bubbles", width, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
  await page.until(`() => document.querySelector('.terminal-tabs')`);
  await page.call(`(n) => { window.__fake.app.handlers['terminal.list'] = () => Array.from({length:n}, (_, i) => ({id:String(300+i),owner:'runner',title:'run '+(i+1),program:'zsh',running:true,exit_code:null,cwd:'/p'})); window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'terminal.changed'}); }`, runs);
  await page.until(`() => document.querySelectorAll('.terminal-tab').length === ${runs}`);
};

/** At 700 the Shelf is a modal overlay over the pane; reachability is read with it dismissed. */
const dismissOverlay = async (): Promise<void> => {
  await page.call(`() => document.querySelector('.shelf-scrim')?.click()`);
  await page.until(`() => { const s = document.querySelector('.shelf-scrim'); return !s || getComputedStyle(s).pointerEvents !== 'auto'; }`);
};

const each = async (body: (width: number, scheme: "light" | "dark") => Promise<void>): Promise<void> => {
  for (const scheme of ["light", "dark"] as const) for (const width of [1280, 700]) await body(width, scheme);
};

it("u534_the_tab_region_ends_before_the_resource_values_and_the_shelf", async () => {
  await each(async (width, scheme) => {
    await eight(width, scheme);
    const r = await page.call<{ host: number[]; pane: number[]; values: number[][]; tabs: number[][]; shelf: number | null; overflow: string }>(`() => {
      const b = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
      const host = document.querySelector('.terminal-tabs-host');
      const shelf = document.querySelector('.shelf');
      return { host: b(host), pane: b(document.querySelector('.centre-stack')), shelf: shelf ? shelf.getBoundingClientRect().left : null,
        values: [...document.querySelectorAll('.resource-agent, .resource-stale')].map(b),
        tabs: [...document.querySelectorAll('.terminal-tab-pair')].map(b), overflow: getComputedStyle(host).overflowX };
    }`);
    const tag = `${width} ${scheme}`;

    expect(r.host[0], tag).toBeGreaterThanOrEqual(r.pane[0] - 1);
    expect(r.host[2], tag).toBeLessThanOrEqual(r.pane[2] + 1);
    if (r.shelf !== null) expect(r.host[2], `${tag} shelf`).toBeLessThanOrEqual(r.shelf + 1);
    for (const v of r.values) expect(r.host[2] <= v[0] + 1 || r.host[3] <= v[1] || v[3] <= r.host[1], `${tag} values`).toBe(true);
    expect(r.overflow, tag).not.toBe("visible");
  });
}, 180_000);

it("u534_every_tab_is_reachable_by_pointer_after_scrolling", async () => {
  await each(async (width, scheme) => {
    await eight(width, scheme);
    await dismissOverlay();
    const misses = await page.call<string[]>(`() => {
      const tabs = document.querySelector('.terminal-tabs');
      return [...tabs.querySelectorAll('.terminal-tab, .terminal-tab-pair button:last-child')].flatMap((c) => {
        c.scrollIntoView({ inline: 'nearest' });
        const r = c.getBoundingClientRect(), t = tabs.getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return r.left >= t.left - 1 && r.right <= t.right + 1 && c.contains(hit) ? [] : [c.getAttribute('aria-label')];
      });
    }`);

    expect(misses, `${width} ${scheme}`).toEqual([]);
  });
}, 180_000);

it("u534_a_scrollable_region_shows_which_edge_has_more_tabs", async () => {
  await each(async (width, scheme) => {
    await eight(width, scheme);
    const read = `() => { const t = document.querySelector('.terminal-tabs'), s = getComputedStyle(t); return { start: parseFloat(s.getPropertyValue('--tabs-fade-start')), end: parseFloat(s.getPropertyValue('--tabs-fade-end')), scrolls: t.scrollWidth > t.clientWidth }; }`;
    const first = await page.call<{ start: number; end: number; scrolls: boolean }>(read);
    const tag = `${width} ${scheme}`;

    expect(first.scrolls, tag).toBe(true);
    expect(first.start, `${tag} nothing before the first tab`).toBe(0);
    expect(first.end, `${tag} more after`).toBeGreaterThan(0);
    await page.call(`() => { const t = document.querySelector('.terminal-tabs'); t.scrollLeft = t.scrollWidth; }`);
    await page.until(`() => parseFloat(getComputedStyle(document.querySelector('.terminal-tabs')).getPropertyValue('--tabs-fade-end')) === 0`);
    const last = await page.call<{ start: number; end: number }>(read);

    expect(last.start, `${tag} more before`).toBeGreaterThan(0);
    expect(last.end, `${tag} nothing after the last tab`).toBe(0);
  });
  await eight(1280, "light", 1);
  const quiet = await page.call<number>(`() => parseFloat(getComputedStyle(document.querySelector('.terminal-tabs')).getPropertyValue('--tabs-fade-end'))`);

  expect(quiet, "one tab fits: no cue").toBe(0);
}, 180_000);

it("u534_eight_runs_keep_the_bar_height", async () => {
  const rects = `() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }; return [r('.resource-strip'), r('.pane'), r('.thread-composer')]; }`;

  await each(async (width, scheme) => {
    await eight(width, scheme, 1);
    const one = await page.call<number[][]>(rects);

    await eight(width, scheme, 8);
    expect(await page.call<number[][]>(rects), `${width} ${scheme}`).toEqual(one);
  });
}, 240_000);

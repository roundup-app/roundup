import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage, FULLSCREEN } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U444 requires Chromium");
  page = await openPage(chrome);
  await page.load("/harness.html?seed=resources", 1280, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => localStorage.setItem("roundup:shelf:/Users/you/harness", JSON.stringify({open: false, tab: "todos"}))`);
}, 90_000);

afterAll(async () => { await page?.close(); });

it("u444_the_strip_is_the_centres_last_line_under_the_terminal", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);

    for (const width of [FULLSCREEN.width]) {
      await page.load("/harness.html?seed=door-report", width, FULLSCREEN.height);
      await page.until(`() => Boolean(window.__fake)`);
      await page.call(`() => { const node = window.__fake.app.handlers['rail.tree']().find(n => n.status && n.status.kind !== 'done'); document.querySelector('[data-id="' + node.id + '"]').click(); }`);
      await page.until(`() => Boolean(document.querySelector('.resource-agent .resource-num'))`);
      await page.until(`() => Boolean(document.querySelector('.pane-screen'))`);

      const read = await page.call<{last: boolean; inside: boolean; gap: number; centres: number[]; iconGaps: number[]; expectedIconGap: number; clipped: string[]}>(`() => {
        const strip = document.querySelector('.resource-strip');
        const pane = document.querySelector('.pane');
        const line = strip.getBoundingClientRect();
        const hint = strip.querySelector('.hint-line');
        const below = line.top + (hint ? hint.getBoundingClientRect().height : 0);
        const box = pane.getBoundingClientRect();
                const values = [...strip.querySelectorAll('.resource-value, .resource-stale')];
        return { last: strip.parentElement.lastElementChild === strip,
          inside: line.left >= box.left - 1 && line.right <= box.right + 1,
          gap: line.top - box.bottom,
          centres: [...strip.querySelectorAll('.resource-agent, .resource-stale, .terminal-tabs-host, .terminal-new')].map(value => { const r=value.getBoundingClientRect(); return r.top+r.height/2-(below+line.bottom)/2; }),
          iconGaps: values.filter(value => value.matches('.resource-value')).map(value => value.querySelector('.resource-num').getBoundingClientRect().left-value.querySelector('svg').getBoundingClientRect().right),
          expectedIconGap: parseFloat(getComputedStyle(strip).getPropertyValue('--space-1')),
          clipped: values.filter(value => { const r = value.getBoundingClientRect(); return !value.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) || r.width === 0 || r.height === 0 || r.left < line.left || r.right > line.right || r.top < line.top || r.bottom > Math.min(line.bottom, innerHeight); }).map(value => value.textContent) };
      }`);

      expect(read.last).toBe(true);
      expect(await page.call(`() => Boolean(document.querySelector('.resource-strip .terminal-new'))`)).toBe(true);
      expect(read.inside).toBe(true);
      expect(read.gap).toBeGreaterThanOrEqual(-1);
      expect(read.clipped).toEqual([]);

      for (const centre of read.centres) expect(Math.abs(centre)).toBeLessThanOrEqual(1);
      expect(read.iconGaps.length).toBeGreaterThan(0);

      for (const gap of read.iconGaps) expect(gap).toBe(read.expectedIconGap);
      const dir = captureDir("U444");

      if (dir) {
        mkdirSync(dir, { recursive: true });
        const name = `composer-${width}x800-${scheme}`;
        writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
        writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
        writeFileSync(join(dir, `${name}.geometry.json`), JSON.stringify(read, null, 2));
      }
    }
  }
}, 120_000);

it("u408_the_rail_holds_none_of_it", async () => {
  for (const seed of ["tree-40", "agents-10"]) {
    await page.load(`/harness.html?seed=${seed}`, 1280, 800);
    await page.until(`() => Boolean(document.querySelector('.rail-row'))`);
    expect(await page.call(`() => document.querySelectorAll('.rail .resource-value, .rail .resource-num, .rail .resource-stale').length`)).toBe(0);
  }
}, 60_000);

it("u444_the_terminal_does_not_move_as_the_strip_fills_or_empties", async () => {
  await page.load("/harness.html?seed=door-report", 1280, 800);
  await page.until(`() => document.querySelector('.pane-screen') && document.querySelector('.resource-num')`);
  const rectangles = `() => ['.resource-strip','.pane'].map(selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })`;
  const before = await page.call(rectangles);
  await page.call(`() => { const sample=window.__fake.app.handlers['project.resources'](); window.__fake.app.handlers['project.resources']=()=>({...sample, agents:[]}); }`);
  await page.until(`() => document.querySelectorAll('.resource-num').length === 0`);
  expect(await page.call(rectangles)).toEqual(before);
  expect(await page.call(`() => Boolean(document.querySelector('.terminal-new'))`)).toBe(true);
}, 60_000);

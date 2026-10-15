import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
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

it("u444_the_strip_is_the_centres_last_line_under_the_composer", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);

    for (const width of [1280, 1440]) {
      await page.load("/harness.html?seed=thread-report", width, 800);
      await page.until(`() => Boolean(window.__fake)`);
      await page.call(`() => { const node = window.__fake.app.handlers['rail.tree']().find(n => n.status && n.status.kind !== 'done'); document.querySelector('[data-id="' + node.id + '"]').click(); }`);
      await page.until(`() => Boolean(document.querySelector('.resource-agent .resource-num'))`);
      await page.until(`() => Boolean(document.querySelector('.thread-composer'))`);

      const read = await page.call<{last: boolean; after: boolean; sides: number[]; gap: number; sideGap: number; clipped: string[]}>(`() => {
        const strip = document.querySelector('.resource-strip');
        const composer = document.querySelector('.thread-composer');
        const line = strip.getBoundingClientRect();
        const box = composer.getBoundingClientRect();
        const sideGap = parseFloat(getComputedStyle(composer.closest('.centre')).paddingLeft);
        const values = [...strip.querySelectorAll('.resource-value, .resource-stale')];
        return { last: strip.parentElement.lastElementChild === strip,
          after: strip.previousElementSibling.classList.contains('thread'),
          sides: [line.left - box.left, line.right - box.right],
          gap: line.top - box.bottom, sideGap,
          clipped: values.filter(value => { const r = value.getBoundingClientRect(); return !value.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) || r.width === 0 || r.height === 0 || r.left < line.left || r.right > line.right || r.top < line.top || r.bottom > Math.min(line.bottom, innerHeight); }).map(value => value.textContent) };
      }`);

      expect(read.last).toBe(true);
      expect(await page.call(`() => Boolean(document.querySelector('.resource-strip .terminal-new'))`)).toBe(true);
      expect(read.after).toBe(true);

      for (const side of read.sides) expect(Math.abs(side)).toBeLessThanOrEqual(1);
      expect(read.gap).toBe(read.sideGap);
      expect(read.clipped).toEqual([]);
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

it("u444_the_dense_strip_clips_no_value", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);

    for (const width of [1280, 1440]) {
      await page.load("/harness.html?seed=resources", width, 800);
      await page.until(`() => Boolean(window.__fake)`);
      await page.call(`() => { const node = window.__fake.app.handlers['rail.tree']().find(n => n.status && n.status.kind !== 'done'); document.querySelector('[data-id="' + node.id + '"]').click(); }`);
      await page.until(`() => Boolean(document.querySelector('.resource-agent .resource-num'))`);

      await page.call(`() => { window.__fake.app.handlers['project.resources'] = () => { throw new Error('not updating'); }; }`);
      await page.until(`() => Boolean(document.querySelector('.resource-stale'))`);

      expect(await page.call(`() => document.querySelectorAll('.resource-value').length`)).toBe(3);

      const clipped = await page.call<string[]>(`() => {
        const box = document.querySelector('.resource-strip').getBoundingClientRect();
        return [...document.querySelectorAll('.resource-value, .resource-stale')].filter(value => {
          const r = value.getBoundingClientRect();
          return !value.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) || r.width === 0 || r.height === 0 || r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > Math.min(box.bottom, innerHeight);
        }).map(value => value.textContent);
      }`);

      expect(clipped).toEqual([]);
      const dir = captureDir("U444");

      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `dense-${width}x800-${scheme}.png`), Buffer.from(await page.shot(), "base64"));
        writeFileSync(join(dir, `dense-${width}x800-${scheme}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
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

it("u408_selection_and_samples_keep_project_totals_out_of_the_resource_region", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);

    for (const width of [1280, 1440]) {
      await page.load("/harness.html?seed=resources", width, 800);
      await page.until(`() => Boolean(window.__fake)`);
      await page.call(`() => document.querySelector('[data-id="worktree-agent"]').click()`);
      await page.until(`() => document.querySelectorAll('.resource-num').length === 3`);

      const read = `() => {
        const rect = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,w:r.width,h:r.height} : null; };
        return {values:[...document.querySelectorAll('.resource-num')].map(e=>e.textContent),
          words:document.querySelector('.resource-strip').textContent, bar:rect('.resource-strip'), pane:rect('.pane'), composer:rect('.thread-composer'),
          focused:document.activeElement?.outerHTML, calls:window.__fake.app.calls.filter(c=>c.method==='project.resources').length, checks:window.__checks()};
      }`;

      const before = await page.call<{values:string[];bar:unknown}>(read);
      expect(before.values).toEqual(["1.0 TB", "1600%", "12.3 TB"]);
      expect(await page.call(`() => document.querySelector('.resource-project,.resource-word')`)).toBeNull();
      await page.call(`() => { const sample=window.__fake.app.handlers['project.resources'](); window.__fake.app.handlers['project.resources']=()=>({...sample,total:{memory_bytes:1,cpu_percent:2,disk_bytes:3}}); }`);
      await page.until(`() => window.__fake.app.calls.filter(c=>c.method==='project.resources').length >= 2`);
      expect((await page.call<{values:string[]}>(read)).values).toEqual(before.values);
      await page.call(`() => { const success=window.__fake.app.handlers['project.resources']; window.__fake.recoverResources=success; window.__fake.app.handlers['project.resources']=()=>{throw new Error('unavailable');}; }`);
      await page.until(`() => Boolean(document.querySelector('.resource-stale'))`);
      expect((await page.call<{values:string[]}>(read)).values).toEqual(before.values);
      const dir = captureDir("U408");

      if (dir) {
        mkdirSync(dir, {recursive:true});
        writeFileSync(join(dir, `selected-failure-${width}-${scheme}.png`), Buffer.from(await page.shot(), "base64"));
        writeFileSync(join(dir, `selected-failure-${width}-${scheme}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
        writeFileSync(join(dir, `selected-failure-${width}-${scheme}.geometry.json`), JSON.stringify(await page.call(read)));
      }

      await page.call(`() => { window.__fake.app.handlers['project.resources']=window.__fake.recoverResources; }`);
      await page.until(`() => !document.querySelector('.resource-stale')`);
      await page.call(`() => document.querySelector('[data-id="finished-agent"]').click()`);
      await page.until(`() => document.querySelector('[data-id="finished-agent"]').getAttribute('aria-selected')==='true'`);
      const empty = await page.call<{values:string[];words:string;bar:unknown;calls:number}>(read);
      expect(empty.values).toEqual([]);
      // Terminal controls may remain; the resource region itself has no stale feedback or values.
      expect(await page.call(`() => document.querySelector('.resource-value,.resource-stale,.resource-project')`)).toBeNull();
      expect(empty.bar).toEqual(before.bar);
    }
  }
}, 120_000);

it("u444_the_composer_does_not_move_as_the_strip_fills_or_empties", async () => {
  await page.load("/harness.html?seed=thread-report", 1280, 800);
  await page.until(`() => document.querySelector('.thread-composer') && document.querySelector('.resource-num')`);
  const rectangles = `() => ['.resource-strip','.pane','.thread-composer'].map(selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })`;
  const before = await page.call(rectangles);
  await page.call(`() => { const sample=window.__fake.app.handlers['project.resources'](); window.__fake.app.handlers['project.resources']=()=>({...sample, agents:[]}); }`);
  await page.until(`() => document.querySelectorAll('.resource-num').length === 0`);
  expect(await page.call(rectangles)).toEqual(before);
  expect(await page.call(`() => Boolean(document.querySelector('.terminal-new'))`)).toBe(true);
}, 60_000);

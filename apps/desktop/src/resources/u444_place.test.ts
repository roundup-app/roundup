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

    for (const width of [1280, 700]) {
      await page.load("/harness.html?seed=thread-report", width, 800);
      await page.until(`() => Boolean(document.querySelector('.resource-project .resource-num'))`);
      await page.until(`() => Boolean(document.querySelector('.thread-composer'))`);

      const read = await page.call<{last: boolean; after: boolean; sides: number[]; gap: number; sideGap: number; clipped: string[]}>(`() => {
        const strip = document.querySelector('.resource-strip');
        const composer = document.querySelector('.thread-composer');
        const line = strip.getBoundingClientRect();
        const box = composer.getBoundingClientRect();
        const sideGap = parseFloat(getComputedStyle(composer.closest('.centre')).paddingLeft);
        const values = [...strip.querySelectorAll('.resource-value, .resource-stale')].filter(value => value.getBoundingClientRect().width);
        return { last: strip.parentElement.lastElementChild === strip,
          after: strip.previousElementSibling.classList.contains('thread'),
          sides: [line.left - box.left, line.right - box.right],
          gap: line.top - box.bottom, sideGap,
          clipped: values.filter(value => { const r = value.getBoundingClientRect(); return r.left < line.left || r.right > line.right || r.top < line.top || r.bottom > Math.min(line.bottom, innerHeight); }).map(value => value.textContent) };
      }`);

      expect(read.last).toBe(true);
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

    for (const width of [1280, 700]) {
      await page.load("/harness.html?seed=resources", width, 800);
      await page.until(`() => Boolean(document.querySelector('.resource-project .resource-num'))`);
      await page.call(`() => document.querySelector('[data-id="worktree-agent"]').click()`);
      await page.until(`() => Boolean(document.querySelector('.resource-agent .resource-num'))`);

      await page.call(`() => { window.__fake.app.handlers['project.resources'] = () => { throw new Error('not updating'); }; }`);
      await page.until(`() => Boolean(document.querySelector('.resource-stale'))`);

      const clipped = await page.call<string[]>(`() => {
        const box = document.querySelector('.resource-strip').getBoundingClientRect();
        return [...document.querySelectorAll('.resource-value, .resource-stale')].filter(value => {
          const r = value.getBoundingClientRect();
          return r.width && (r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > Math.min(box.bottom, innerHeight));
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

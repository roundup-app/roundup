import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage, FULLSCREEN } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

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

      expect(await page.call(`() => { const strip = document.querySelector('.resource-strip'); return strip.parentElement.lastElementChild === strip; }`)).toBe(true);
      expect(await page.call(`() => Boolean(document.querySelector('.resource-strip .terminal-new'))`)).toBe(true);
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

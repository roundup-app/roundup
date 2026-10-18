import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2236 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const open = async (): Promise<void> => {
  await page.load("/harness.html?seed=bubbles", 1280, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
  await page.until(`() => document.querySelector('button.terminal-tab')`);
  await page.call(`() => { const tab = document.querySelector('button.terminal-tab'); if (document.querySelector('.bubble')?.hidden) tab.click(); }`);
  await page.until(`() => document.querySelector('.bubble:not([hidden]) .bubble-header') && document.querySelector('.bubble-zone:not([hidden])')`);
};

it("u2237_fill_and_restore_refit_once", async () => {
  await open();

  const header = () => page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('.bubble:not([hidden]) .bubble-name').getBoundingClientRect(); return { x: r.right + 4, y: r.y + r.height / 2 }; }`);
  const sizes = () => page.call<number>(`() => window.__fake.app.calls.filter((call) => call.method === 'terminal.resize').length`);
  const settle = () => page.call(`() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);

  await settle();

  const start = await sizes();

  const at = await header();

  await page.doubleClick(at.x, at.y);
  await settle();
  expect(await sizes()).toBe(start + 1);

  const again = await header();

  await page.doubleClick(again.x, again.y);
  await settle();
  expect(await sizes()).toBe(start + 2);
  expect(await page.call<number>(`() => window.__fake.app.calls.filter((call) => call.method === 'terminal.write').length`)).toBe(0);
}, 90_000);

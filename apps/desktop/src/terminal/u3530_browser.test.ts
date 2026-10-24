import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U3530 needs isolated headless Chromium");
  page = await openPage(chrome);
});

afterAll(async () => { await page?.close(); });

it("u3530a_terminal_scrollbar_tracks_scrollable_content", async () => {
  const output = captureDir("U3530a");

  const capture = async (step: string) => {
    if (!output) return;

    mkdirSync(join(output, "head"), { recursive: true });
    writeFileSync(join(output, "head", `${step}.png`), Buffer.from(await page.shot(), "base64"));
    writeFileSync(join(output, "head", `${step}.checks.json`), JSON.stringify(await page.call("() => window.__checks()")));
  };

  await page.scheme("dark");
  await page.load("/harness.html?seed=door-stopped");
  await page.until("() => Boolean(window.__fake && document.querySelector('.terminal-new'))");
  await page.call("() => document.querySelector('.terminal-new').click()");
  await page.until("() => Boolean(document.querySelector('.bubble:not([hidden]) .xterm-scrollable-element .slider'))");

  const rows = await page.call<number>(`() => {
    window.scrollbarTerminal = [...window.__terminals.keys()].at(-1);
    return window.__terminals.get(window.scrollbarTerminal).fit().rows;
  }`);

  const point = await page.call<{ x: number; y: number }>(`() => {
    const box = document.querySelector('.bubble:not([hidden]) .xterm-screen').getBoundingClientRect();
    window.thumbVisible = () => {
      let el = document.querySelector('.bubble:not([hidden]) .scrollbar.vertical .slider');
      if (!el || !el.getBoundingClientRect().height) return false;
      while (el) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        el = el.parentElement;
      }
      return true;
    };
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }`);

  await page.hover(point.x, point.y);

  const write = async (count: number) => {
    await page.call(`async (count) => {
      window.__fake.writeOutput(window.scrollbarTerminal, Array.from({length: count}, (_, i) => 'line ' + i).join('\\r\\n'));
      await new Promise(resolve => window.__terminals.get(window.scrollbarTerminal).write(new Uint8Array(), resolve));
    }`, count);
  };

  await write(Math.max(2, Math.floor(rows / 2)));
  expect(await page.call("() => window.__terminals.get(window.scrollbarTerminal).isAtBottom()")).toBe(true);
  expect(await page.call("() => window.thumbVisible()")).toBe(false);
  await capture("fitting");
  await write(rows * 2);
  await page.until("() => window.__terminals.get(window.scrollbarTerminal).isAtBottom()");
  await page.wheel(point.x, point.y, -150);
  await page.until("() => !window.__terminals.get(window.scrollbarTerminal).isAtBottom() && window.thumbVisible()");
  expect(await page.call("() => window.thumbVisible()")).toBe(true);
  await capture("scrolling");
  await page.until("() => !window.thumbVisible()", 1000);
  await capture("idle");
  expect(await page.call("() => window.__terminals.get(window.scrollbarTerminal).isAtBottom()")).toBe(false);
});

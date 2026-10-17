import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage, FULLSCREEN } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U523 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const open = async (width: number, scheme: "light" | "dark") => {
  await page.scheme(scheme);
  await page.load("/harness.html?seed=door-stopped", width, FULLSCREEN.height);
  await page.until(`() => document.querySelector('.terminal-new')`);
  await page.call(`() => document.querySelector('.terminal-new').click()`);
  await page.until(`() => document.querySelector('.bubble:not([hidden]) .xterm-screen')`);
};

it("u523_focus_and_terminal_paint_fit_the_panel", async () => {
  await open(1280, "light");
  await page.call(`() => document.querySelector('.bubble-header').focus()`);
  await page.press("Tab", "Tab");

  const read = await page.call<{ focused: string | null; ring: string }>(`() => ({ focused: document.activeElement.getAttribute('aria-label'), ring: getComputedStyle(document.activeElement).outlineStyle })`);

  expect(read.focused).toBe("Close");
  expect(read.ring).not.toBe("none");
}, 60_000);

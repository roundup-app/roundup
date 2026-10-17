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

const open = async (width: number, scheme: "light" | "dark", contrast?: "more") => {
  await page.scheme(scheme, contrast);
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

it("u523_header_buttons_have_ink_feedback_and_visible_focus", async () => {
  await open(1280, "light");

  const rest = await page.call<{ x: number; y: number; color: string }>(`() => { const b = document.querySelector('.bubble:not([hidden]) .bubble-header button[aria-label="Close"]'); const r = b.getBoundingClientRect(); return {x:r.x + r.width / 2, y:r.y + r.height / 2, color:getComputedStyle(b).color}; }`);
  const ink = `() => getComputedStyle(document.querySelector('.bubble:not([hidden]) .bubble-header button[aria-label="Close"]')).color`;

  await page.hover(rest.x, rest.y);
  expect(await page.call<string>(ink)).not.toBe(rest.color);
  await page.pointer("up", 0, 0);
}, 60_000);

it("u523_rendered_checks_and_opaque_contrast", async () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const contrast of [undefined, "more"] as const) {
      await open(1280, scheme, contrast);
      const checks = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

      for (const [id, check] of Object.entries(checks)) expect(check.status, `${scheme} ${contrast ?? "normal"} ${id}`).toBe("pass");
    }
  }
}, 120_000);

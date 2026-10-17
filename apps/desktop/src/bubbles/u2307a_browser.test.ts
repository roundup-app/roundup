import { afterAll, beforeAll, expect, it } from "vitest";
import type { ChromePage } from "../testing/chromePage";
import { centreOf, openBubblePage, showBubble } from "./u2307_browser";

let page: ChromePage;

beforeAll(async () => { page = await openBubblePage(); }, 90_000);

afterAll(async () => { await page?.close(); });

const state = () => page.call<{ open: boolean }>(`() => ({ open: Boolean(document.querySelector('.bubble:not([hidden])')) })`);

it("u2307a_browser_an_outside_press_on_the_rail_the_door_terminal_and_the_header_minimises_and_reaches_the_target", async () => {
  for (const target of [".rail-row", ".pane-screen", ".window-title"]) {
    await showBubble(page);

    // The Door terminal is reached below the bubble, at its trailing corner.
    const at = target === ".pane-screen"
      ? await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('.pane-screen').getBoundingClientRect(); return { x: r.right - 20, y: r.bottom - 20 }; }`)
      : await centreOf(page, target);

    await page.click(at.x, at.y);
    await page.until(`() => !document.querySelector('.bubble:not([hidden])')`);
    expect((await state()).open, target).toBe(false);
    // The press reached its target: focus or selection moved off the minimised bubble.
    expect(await page.call<boolean>(`() => !document.activeElement?.closest('.bubble')`), target).toBe(true);
  }
}, 120_000);

it("u2307a_browser_escape_stays_in_the_terminal", async () => {
  await showBubble(page);
  await page.call(`() => document.querySelector('.bubble:not([hidden]) .xterm-helper-textarea, .bubble:not([hidden]) [data-terminal]').focus()`);
  await page.press("Escape", "Escape");
  expect((await state()).open).toBe(true);
  expect(await page.call<boolean>(`() => Boolean(document.activeElement?.closest('.bubble'))`)).toBe(true);
}, 60_000);

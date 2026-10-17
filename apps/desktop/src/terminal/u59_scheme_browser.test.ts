import { afterAll, beforeAll, expect, it } from "vitest";
import type { ChromePage } from "../testing/chromePage";
import { openBubblePage } from "../testing/u2307Browser";

let page: ChromePage;

beforeAll(async () => { page = await openBubblePage(); }, 90_000);

afterAll(async () => { await page?.close(); });

// The DOM renderer paints default text from the emulator theme's foreground; dark text means the light theme.
const foreground = `() => getComputedStyle(document.querySelector('.bubble:not([hidden]) .xterm-rows')).color`;

const luminance = (rgb: string) => (rgb.match(/\d+/g) ?? []).slice(0, 3).reduce((sum, c) => sum + Number(c), 0) / 3;

it("u59_a_bubble_terminal_opened_after_the_scheme_turned_dark_is_dark_and_follows_a_live_switch", async () => {
  await page.scheme("light");
  await page.load("/harness.html?seed=door-stopped");
  await page.until(`() => document.querySelector('.terminal-new')`);
  await page.scheme("dark");
  await page.call(`() => document.querySelector('.terminal-new').click()`);
  await page.until(`() => document.querySelector('.bubble:not([hidden]) .xterm-screen')`);

  // Dark ground, so light text.
  expect(luminance(await page.call<string>(foreground))).toBeGreaterThan(128);

  await page.scheme("light");
  await page.until(`() => (getComputedStyle(document.querySelector('.bubble:not([hidden]) .xterm-rows')).color.match(/\\d+/g) ?? []).slice(0, 3).every((c) => Number(c) < 128)`);
}, 60_000);

import { afterAll, beforeAll, expect, it } from "vitest";
import type { ChromePage } from "../testing/chromePage";
import { openBubblePage, showBubble } from "./u2307_browser";

let page: ChromePage;

beforeAll(async () => { page = await openBubblePage(); }, 90_000);

afterAll(async () => { await page?.close(); });

const probe = `() => {
  const box = document.querySelector('.bubble:not([hidden])').getBoundingClientRect();
  const points = [[box.x + box.width / 2, box.y + box.height / 2], [box.left + 4, box.top + 4], [box.right - 4, box.top + 4], [box.left + 4, box.bottom - 4], [box.right - 4, box.bottom - 4]];
  return points.map(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.bubble-frame')));
}`;

it("u2307b_the_bubble_is_topmost_at_its_centre_and_corners_over_a_toast_menu_and_drawer", async () => {
  await showBubble(page);
  expect(await page.call<boolean[]>(probe)).toEqual([true, true, true, true, true]);

  // A layer with the largest z-index there is, covering the bubble, and the tab's menu.
  await page.call(`() => { const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647'; cover.className = 'toast-stand-in'; document.body.append(cover); }`);
  expect(await page.call<boolean[]>(probe)).toEqual([true, true, true, true, true]);
  await page.call(`() => document.querySelector('.terminal-tab-pair').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))`);
  await page.until(`() => document.querySelector('[role="menu"]')`);
  expect(await page.call<boolean[]>(probe)).toEqual([true, true, true, true, true]);
}, 90_000);

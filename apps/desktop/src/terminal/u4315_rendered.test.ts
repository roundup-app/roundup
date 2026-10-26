import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let page: LaneBrowser;
beforeAll(async () => { page = await openLane(1512, "dark", "u4315"); }, 90_000);
afterAll(async () => { await page?.close(); });

it("u4315b_sub_links_switch_by_click_and_arrow", async () => {
  const dir = captureDir("U4315b");
  if (dir) { mkdirSync(dir, { recursive: true }); await page.browser("record", "start", join(dir, "navigation.webm")); }
  await page.browser("click", ".rail-row[data-id=payments]");
  await page.until("!!document.querySelector('.pane-navigation [role=tab]')");
  await page.browser("click", '.pane-navigation [data-value="dashboard"]');
  await page.until("!!document.querySelector('.measurement-dashboard')");
  await page.browser("click", '.pane-navigation [data-value="timeline"]');
  await page.until("!!document.querySelector('.timeline-view')");
  await page.browser("press", "ArrowLeft");
  await page.until("document.querySelector('.pane-navigation [data-value=dashboard]').getAttribute('aria-selected') === 'true'");
  expect(await page.focused()).toBe("Time");
  expect(await page.evaluate("!!document.querySelector('.measurement-dashboard[data-home=payments]')")).toBe(true);
  await page.browser("press", "ArrowRight");
  await page.until("document.querySelector('.pane-navigation [data-value=timeline]').getAttribute('aria-selected') === 'true'");
  expect(await page.focused()).toBe("Timeline");
  expect(await page.evaluate("document.querySelectorAll('.pane-navigation [role=tab][aria-selected=true]').length")).toBe(1);
  expect(await page.evaluate("document.querySelector('.rail-row[data-id=payments]').closest('[role=treeitem]').getAttribute('aria-selected')")).toBe("true");
  await page.capture("U4315b", "timeline-selected");
  await page.browser("press", "Escape");
  await page.until("!document.querySelector('.timeline-view')");
  expect(await page.focused()).toBe("Timeline");
  if (dir) await page.browser("record", "stop");
}, 60_000);

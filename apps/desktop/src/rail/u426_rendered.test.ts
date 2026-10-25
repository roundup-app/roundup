import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U426 requires isolated Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const load = async (seed: string, width: number, scheme: "light" | "dark") => {
  await page.scheme(scheme);
  const path = `/harness.html?seed=${seed}`;
  await page.load(path, width, 800);
  await page.until(`() => document.querySelectorAll('.rail-row').length >= 9`, 60_000);
};

// Tab and Enter or Space reach the same icons at any Rail width; the default width stands for the rest.
for (const railWidth of [288]) {
  it(`u426_every_icon_is_reached_by_tab_and_enter_or_space_runs_without_selecting ${railWidth}`, async () => {
    await load("tree-40", 1280, "light");
    await page.call(`width => { document.querySelector('.rail').style.width=width+'px'; document.querySelector('.rail-row').focus(); }`, railWidth);
    await page.press("Tab", "Tab");
    await page.until(`() => document.activeElement.getAttribute('aria-label') === 'Collapse'`);
    const labels = ["Add Agent", "Start supervisor", "Clear", "Open folder", "Open in editor"];

    for (const label of labels) {
      await page.press("Tab", "Tab");
      await page.until(`() => document.activeElement.getAttribute('aria-label')?.startsWith(${JSON.stringify(label)})`);
    }

    const selected = await page.call(`() => document.querySelector('.rail-row[data-selected="true"]')?.dataset.id ?? null`);
    await page.press("Enter", "Enter");
    await page.until(`() => window.__fake.app.editorOpened.length === 1`);
    expect(await page.call(`() => document.querySelector('.rail-row[data-selected="true"]')?.dataset.id ?? null`)).toBe(selected);

    await page.call(`() => document.querySelector('.rail-row [aria-label="Open folder"]').focus()`);
    await page.press(" ", "Space");
    await page.until(`() => window.__fake.app.openedTargets.length === 1`);
    expect(await page.call(`() => document.querySelector('.rail-row[data-selected="true"]')?.dataset.id ?? null`)).toBe(selected);
  }, 60_000);
}

it("u426_the_stopped_door_keeps_a_readable_control_beside_the_group", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => document.querySelector('.rail-row[data-id="auth"]').focus()`);
  await page.until(`() => document.querySelector('.rail-row[data-id="auth"]').dataset.near === 'true'`);
  expect(await page.call(`() => document.querySelector('.rail-row[data-id="auth"] .door-action').getAttribute('aria-label')`)).toBe("Start supervisor");
  expect(await page.call(`() => Boolean(document.querySelector('.rail-row[data-id="auth"] .door-action svg.lucide-play'))`)).toBe(true);
}, 60_000);

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

it("u427_the_clear_icon_opens_a_visible_reason_prompt_without_selecting", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => document.querySelector('.rail-row[data-id="backend"]').click()`);
  await page.until(`() => document.querySelector('.rail-row[data-id="backend"]').dataset.selected === 'true'`);
  await page.call(`() => document.querySelector('.rail-row[data-id="auth"] [aria-label^="Clear"]').click()`);
  await page.until(`() => Boolean(document.querySelector('[role="dialog"] [data-clear-prompt] textarea'))`);
  expect(await page.call(`() => document.querySelector('.rail-row[data-selected="true"]').dataset.id`)).toBe("backend");
  expect(await page.call(`() => document.activeElement === document.querySelector('[role="dialog"] textarea')`)).toBe(true);
  expect(await page.call(`() => window.__fake.app.calls.filter(c=>c.method==='workstream.clear').length`)).toBe(0);
  await page.call(`() => [...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Keep').click()`);
  await page.until(`() => !document.querySelector('[role="dialog"] [data-clear-prompt]')`);
}, 60_000);

it("u429_the_rail_shows_a_missing_editor_in_one_failure_line", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => {
    window.__fake.app.editorFailure = new Error('no code editor found; install VS Code or Cursor, or set ROUNDUP_EDITOR');
    document.querySelector('.rail-row [aria-label="Open in editor"]').click();
  }`);
  await page.until(`() => document.querySelector('.rail > .ink')?.textContent.includes('no code editor found')`);
  expect(await page.call(`() => document.querySelectorAll('.rail > .ink').length`)).toBe(1);
}, 60_000);

it("u426_only_workstream_and_agent_rows_carry_icons", async () => {
  await load("tree-40", 1280, "dark");
  await page.call(`() => document.querySelector('.rail-pads-control').click()`);
  await page.until(`() => document.querySelectorAll('.rail-leaf').length > 0`);

  const read = await page.call<{projectTabs:number; leaves:number; rowGroups:number[]; otherGroups:number}>(`() => ({
    projectTabs:document.querySelectorAll('.project-tab').length,
    leaves:document.querySelectorAll('.rail-leaf').length,
    rowGroups:[...document.querySelectorAll('.rail-row')].map(r=>r.querySelectorAll('.row-icons').length),
    otherGroups:document.querySelectorAll('.project-tab .row-icons, .rail-leaf .row-icons, .rail-fold .row-icons').length
  })`);

  expect(read.projectTabs).toBeGreaterThan(0);
  expect(read.leaves).toBeGreaterThan(0);
  expect(read.rowGroups.every(count=>count===1)).toBe(true);
  expect(read.otherGroups).toBe(0);
}, 60_000);

it("u426_the_stopped_door_keeps_a_readable_control_beside_the_group", async () => {
  await load("tree-40", 1280, "light");
  await page.call(`() => document.querySelector('.rail-row[data-id="auth"]').focus()`);
  await page.until(`() => document.querySelector('.rail-row[data-id="auth"]').dataset.near === 'true'`);
  expect(await page.call(`() => document.querySelector('.rail-row[data-id="auth"] .door-action').getAttribute('aria-label')`)).toBe("Start supervisor");
  expect(await page.call(`() => Boolean(document.querySelector('.rail-row[data-id="auth"] .door-action svg.lucide-play'))`)).toBe(true);
}, 60_000);

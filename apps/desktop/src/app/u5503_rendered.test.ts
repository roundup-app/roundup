import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let page: Awaited<ReturnType<typeof openLane>>;

let recording = false;

beforeAll(async () => {
  page = await openLane(1512, "dark", "u5503");
  const url = await page.evaluate<string>("location.origin");

  await page.browser("open", `${url}/harness.html?seed=menu-bar-10`);
  await page.until("document.querySelectorAll('.project-tab').length === 2 && window.__fake.app.menuBar?.mark === 'waiting'");
  const output = captureDir("U5503");

  if (output) {
    await mkdir(output, { recursive: true });
    await page.browser("record", "start", join(output, "menu-navigation.webm"));
    recording = true;
  }

  // Recording recreates the context, so restore its media before reading Checks.
  await page.browser("set", "media", "dark");
  await page.until("matchMedia('(prefers-color-scheme: dark)').matches && typeof window.__checks === 'function' && window.__fake?.app.menuBar?.mark === 'waiting'");
  await page.capture("U5503", "before");
}, 60_000);

afterAll(async () => {
  try { if (recording) await page.browser("record", "stop"); }
  finally { await page?.close(); }
});

it("u5503_menu_originated_selection_reaches_the_real_terminal", async () => {
  await page.evaluate(`(() => {
    const row = window.__fake.app.menuBar.dock.find(row => row.action?.kind === 'agent' && row.action.agent === 'menu-door');
    window.__fake.app.menuBarAction(row.action);
    return true;
  })()`);
  await page.until("document.querySelector('[role=treeitem][data-id=menu-door]')?.getAttribute('aria-selected') === 'true'");
  expect(await page.evaluate("window.__terminals.size > 0")).toBe(true);
  await page.capture("U5503", "terminal");
});

it("u5503_removed_menu_agent_shows_recovery_without_a_replacement", async () => {
  const selected = await page.evaluate("document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id') ?? null");
  await page.evaluate("window.__fake.app.menuBarAction({kind:'agent',path:'/Users/you/harness',agent:'removed'}); true");
  await page.until("document.body.textContent.includes('That is gone')");
  expect(await page.evaluate("document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id') ?? null")).toBe(selected);
  await page.capture("U5503", "failure");
  await page.evaluate("window.__fake.app.menuBarAction({kind:'agent',path:'/Users/you/harness',agent:'agent-2'}); true");
  await page.until("document.querySelector('[role=treeitem][data-id=agent-2]')?.getAttribute('aria-selected') === 'true' && !document.querySelector('.reserved-line [role=alert]')");
  await page.capture("U5503", "recovered");
});

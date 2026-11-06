import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

describe.each(["U5502", "U5503"])("%s native menu navigation", id => {
  const enabled = !process.env.ROUNDUP_CAPTURES || captureDir(id) !== null;
  let page: Awaited<ReturnType<typeof openLane>>;
  let recording = false;

  beforeAll(async () => {
    if (!enabled) return;
    page = await openLane(1512, "dark", id.toLowerCase());
    const url = await page.evaluate<string>("location.origin");

    await page.browser("open", `${url}/harness.html?seed=menu-bar-10`);
    await page.until("document.querySelectorAll('.project-tab').length === 2 && window.__fake.app.menuBar?.mark === 'waiting'");
    const output = captureDir(id);

    if (output) {
      await mkdir(output, { recursive: true });
      await page.browser("record", "start", join(output, "menu-navigation.webm"));
      recording = true;
    }

    // Recording recreates the context, so restore its media before reading Checks.
    await page.browser("set", "media", "dark");
    await page.until("matchMedia('(prefers-color-scheme: dark)').matches && typeof window.__checks === 'function' && window.__fake?.app.menuBar?.mark === 'waiting'");
    await page.capture(id, "before");
  }, 60_000);

  afterAll(async () => {
    try { if (recording) await page.browser("record", "stop"); }
    finally { await page?.close(); }
  });

  it.skipIf(!enabled)(`${id.toLowerCase()}_menu_originated_selection_reaches_the_real_terminal`, async () => {
    await page.evaluate(`(() => {
      const rows = window.__fake.app.menuBar.${id === 'U5503' ? 'dock' : 'entries'};
      const row = rows.find(row => row.action?.kind === 'agent' && row.action.agent === 'menu-door');
      window.__fake.app.menuBarAction(row.action);
      return true;
    })()`);
    await page.until("document.querySelector('[role=treeitem][data-id=menu-door]')?.getAttribute('aria-selected') === 'true'");
    expect(await page.evaluate("window.__terminals.size > 0")).toBe(true);
    await page.capture(id, "terminal");
  });

  it.skipIf(!enabled)(`${id.toLowerCase()}_removed_menu_agent_shows_nothing_and_a_valid_one_selects`, async () => {
    const selected = await page.evaluate("document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id') ?? null");
    await page.evaluate("window.__fake.app.menuBarAction({kind:'agent',path:'/Users/you/harness',agent:'removed'}); true");
    await page.evaluate("new Promise(resolve => setTimeout(resolve, 200))");
    expect(await page.evaluate("document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id') ?? null")).toBe(selected);
    await page.capture(id, "failure");
    await page.evaluate("window.__fake.app.menuBarAction({kind:'agent',path:'/Users/you/harness',agent:'agent-2'}); true");
    await page.until("document.querySelector('[role=treeitem][data-id=agent-2]')?.getAttribute('aria-selected') === 'true' && !document.querySelector('.reserved-line [role=alert]')");
    await page.capture(id, "recovered");
  });

});

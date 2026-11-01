import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let page: Awaited<ReturnType<typeof openLane>>;

beforeAll(async () => {
  page = await openLane(1512, "dark", "u5502");
  const url = await page.evaluate<string>("location.origin");

  await page.browser("open", `${url}/harness.html?seed=menu-bar-10`);
  await page.until("document.querySelectorAll('.project-tab').length === 2 && window.__fake.app.menuBar?.mark === 'waiting'");
}, 60_000);

afterAll(async () => { await page?.close(); });

it("u5502_menu_originated_selection_reaches_the_real_terminal", async () => {
  const { browser, evaluate, until, capture } = page;
  const output = captureDir("U5502");

  try {

    if (output) {
      await mkdir(output, { recursive: true });
      await browser("record", "start", join(output, "menu-navigation.webm"));
    }

    await until("typeof window.__checks === 'function' && window.__fake?.app.menuBar?.mark === 'waiting'");
    await capture("U5502", "before");
    await evaluate(`(() => {
      window.__fake.app.menuBarAction({kind:'agent', path:'/Users/you/harness', agent:'menu-door'});
      return true;
    })()`);
    await until("document.querySelector('[role=treeitem][data-id=menu-door]')?.getAttribute('aria-selected') === 'true'");
    expect(await evaluate("window.__terminals.size > 0")).toBe(true);
    await capture("U5502", "terminal");
    await evaluate("window.__fake.app.menuBarAction({kind:'agent',path:'/Users/you/harness',agent:'removed'}); true");
    await until("document.body.textContent.includes('That is gone')");
    await capture("U5502", "failure");

  } finally { if (output) await browser("record", "stop"); }
});

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let page: Awaited<ReturnType<typeof openLane>>;

let recording = false;

beforeAll(async () => {
  page = await openLane(1512, "dark", "u5765", true);
  const origin = await page.evaluate<string>("location.origin");
  await page.browser("open", `${origin}/harness.html?seed=tree-40&project-open=1`);
  await page.until("document.querySelectorAll('[role=treeitem]').length >= 40");
  const output = captureDir("U5765");

  if (output) {
    await mkdir(output, { recursive: true });
    await page.browser("record", "start", join(output, "open-confirmation.webm"));
    recording = true;
    await page.browser("set", "media", "dark", "reduced-motion");
    await page.until("typeof window.__checks === 'function' && document.querySelectorAll('[role=treeitem]').length >= 40");
  }
}, 60_000);

afterAll(async () => {
  try { if (recording) await page.browser("record", "stop"); }
  finally { await page?.close(); }
});

it("u5765_open_confirmation_and_failure_are_visible_on_tree_40", async () => {
  await page.browser("focus", ".ask-input");
  await page.capture("U5765", "before");
  await page.evaluate(`(() => {
    const app = window.__fake.app;
    const path = '/Users/you/Projects/payments-and-reconciliation/customer-records-and-durable-results/another-project-with-a-long-name';
    window.openResult = null;
    void app.requestAction({id:5765,method:'project.open',params:{source:app.opened.project.path,path,agent:{id:'agent-1',name:'builder-for-payments-and-reconciliation-with-a-long-rail-name'}}}).then(reply => window.openResult=reply);
    return true;
  })()`);
  await page.until("document.querySelector('[role=dialog]') !== null");
  await page.capture("U5765", "confirmation");
  expect(await page.evaluate("window.openResult")).toBeNull();
  // A real keyboard Escape refuses the actual registered App handler.
  await page.browser("press", "Escape");
  await page.until("window.openResult?.error?.code === -32002 && !document.querySelector('[role=dialog]')");
  await page.until("document.activeElement?.matches('.ask-input')");
  await page.capture("U5765", "refused");
  await page.evaluate(`(() => {
    const app = window.__fake.app;
    app.opened.failure = window.__fake.refusal(-32001, 'The folder is unavailable. Choose an existing folder and try again.');
    window.openResult=null;
    void app.requestAction({id:5766,method:'project.open',params:{source:app.opened.project.path,path:'/Users/you/Projects/unavailable-folder',agent:{id:'agent-1',name:'builder'}}}).then(reply=>window.openResult=reply);
    return true;
  })()`);
  await page.until("document.querySelector('[role=dialog]') !== null");
  await page.browser("get", "text", "[role=dialog]");
  await page.browser("click", "[role=dialog] button:last-child");
  await page.until("window.openResult?.error?.code === -32001 && document.body.textContent.includes('folder is unavailable')");
  await page.capture("U5765", "failure");
  await page.browser("press", "Escape");
  await page.until("!document.querySelector('[role=dialog]')");
  await page.evaluate(`(() => {
    const app = window.__fake.app;
    app.opened.failure = null;
    window.openResult = null;
    void app.requestAction({id:5767,method:'project.open',params:{source:app.opened.project.path,path:'/Users/you/Projects/keyboard-target',agent:{id:'agent-1',name:'builder'}}}).then(reply => window.openResult=reply);
    return true;
  })()`);
  await page.until("document.querySelector('[role=dialog]') !== null");
  await page.tabTo("Open");
  await page.browser("press", "Enter");
  await page.until("window.openResult?.result?.path === '/Users/you/Projects/keyboard-target' && !document.querySelector('[role=dialog]')");
  expect(await page.evaluate("window.openResult")).toEqual({ jsonrpc: "2.0", id: 5767, result: { path: "/Users/you/Projects/keyboard-target" } });
});

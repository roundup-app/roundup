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

it("u5765_escape_refuses_and_restores_ask_focus_on_tree_40", async () => {
  await page.evaluate(`(async () => {
    const app = window.__fake.app;
    const tree = await app.rpc("rail.tree", null);
    app.handlers['rail.tree'] = () => tree.map(node => ['backend', 'auth', 'migrate'].includes(node.id)
      ? {...node, ...(node.id === 'auth' ? {opening_prompt: 'Review the requested changes'} : {}), start_attribution: {project: '/source', agent: 'builder-source', project_name: 'moo.md', agent_name: 'builder'}} : node);
    window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
    return true;
  })()`);
  await page.until("document.querySelector('.rail-row[data-id=backend]') !== null");

  for (const id of ["backend", "auth", "migrate"]) {
    await page.browser("click", `.rail-row[data-id="${id}"] .name`);
    await page.capture("U5765", `attribution-${id}`);
  }

  await page.evaluate("document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', metaKey: true, bubbles: true }))");
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
  await page.browser("hover", "[role=dialog] button:last-child");
  await page.capture("U5765", "confirmation-hover");
  expect(await page.evaluate("window.openResult")).toBeNull();
  // A real keyboard Escape refuses the actual registered App handler.
  await page.browser("press", "Escape");
  await page.until("window.openResult?.error?.code === -32002 && !document.querySelector('[role=dialog]')");
  await page.until("document.activeElement?.matches('.ask-input')");
  await page.capture("U5765", "refused");
});

it("u5765_open_failure_exposes_the_cause_and_recovery", async () => {
  await page.evaluate(`(() => {
    const app = window.__fake.app;
    app.opened.failure = window.__fake.refusal(-32001, 'The folder is unavailable.');
    window.openResult=null;
    void app.requestAction({id:5766,method:'project.open',params:{source:app.opened.project.path,path:'/Users/you/Projects/unavailable-folder',agent:{id:'agent-1',name:'builder'}}}).then(reply=>window.openResult=reply);
    return true;
  })()`);
  await page.until("document.querySelector('[role=dialog]') !== null");
  await page.browser("get", "text", "[role=dialog]");
  await page.browser("click", "[role=dialog] button:last-child");
  await page.until("window.openResult?.error?.code === -32001 && document.body.textContent.includes('folder is unavailable')");
  expect(await page.evaluate("window.openResult.error.code")).toBe(-32001);
  await page.capture("U5765", "failure");
  await page.browser("press", "Escape");
  await page.until("!document.querySelector('[role=dialog]') && document.activeElement?.matches('.ask-input')");
});

it("u5765_pointer_refusal_restores_ask_focus_after_the_final_queued_request", async () => {
  await page.browser("focus", ".ask-input");
  await page.evaluate(`(() => {
    const app = window.__fake.app;
    window.queuedResults = [];
    for (const id of [5768, 5769]) void app.requestAction({id,method:'project.open',params:{source:app.opened.project.path,path:'/Users/you/Projects/queued-' + id,agent:{id:'agent-1',name:'builder'}}}).then(reply => window.queuedResults.push(reply));
    return true;
  })()`);
  await page.until("document.querySelector('[role=dialog]') !== null");
  await page.browser("click", "[role=dialog] button:first-child");
  await page.until("window.queuedResults.length === 1 && document.querySelector('[role=dialog]')?.textContent.includes('queued-5769')");
  await page.browser("click", "[role=dialog] button:first-child");
  await page.until("window.queuedResults.length === 2 && document.activeElement?.matches('.ask-input')");
  expect(await page.evaluate("window.queuedResults.map(reply => [reply.id, reply.error.code])")).toEqual([[5768, -32002], [5769, -32002]]);
});

it("u5765_keyboard_queue_handoff_keeps_choices_reachable_and_returns_to_ask", async () => {
  await page.browser("focus", ".ask-input");
  await page.evaluate(`(() => {
    const app = window.__fake.app;
    window.queuedResults = [];
    for (const id of [5770, 5771]) void app.requestAction({id,method:'project.open',params:{source:app.opened.project.path,path:'/Users/you/Projects/keyboard-queued-' + id,agent:{id:'agent-1',name:'builder'}}}).then(reply => window.queuedResults.push(reply));
    return true;
  })()`);
  await page.until("document.querySelector('[role=dialog]') !== null");
  await page.tabTo("Refuse");
  await page.browser("press", "Enter");
  await page.until("window.queuedResults.length === 1 && document.querySelector('[role=dialog]')?.textContent.includes('keyboard-queued-5771')");
  await page.browser("press", "Tab");
  expect(await page.focused()).toBe("Open");
  await page.browser("press", "Shift+Tab");
  await page.until("document.activeElement?.textContent === 'Refuse'");
  await page.browser("press", "Enter");
  await page.until("window.queuedResults.length === 2 && document.activeElement?.matches('.ask-input')");
  expect(await page.evaluate("window.queuedResults.map(reply => [reply.id, reply.error.code])")).toEqual([[5770, -32002], [5771, -32002]]);
});

it("u5765_keyboard_open_completes_the_request", async () => {
  await page.browser("focus", ".ask-input");
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
  await page.until("document.activeElement?.matches('[role=tab][aria-selected=true]')");
  await page.capture("U5765", "keyboard-open-focus");
});


it("u5765_target_start_failure_keeps_recovery_reachable", async () => {
  const source = await page.evaluate<string>("window.__fake.app.opened.project.path");
  await page.browser("click", `.project-tab[data-path="${source}"] [role=tab]`);
  await page.until("document.querySelectorAll('[role=treeitem]').length >= 40");
  await page.browser("focus", ".ask-input");
  await page.evaluate(`(() => {
    const app = window.__fake.app;
    const target = app.of('/Users/you/Projects/keyboard-target');
    target.handlers['rail.createWorkstream'] = () => ({id:'created-work',kind:'workstream',name:'target-worker',parent:null});
    target.handlers['workstream.setOpeningPrompt'] = () => null;
    target.handlers['rail.startDoor'] = () => { throw window.__fake.refusal(-32003, 'The vendor could not start. Check its configuration.'); };
    window.startResult = null;
    void app.requestAction({id:5774,method:'project.start',params:{source:app.opened.project.path,path:'/Users/you/Projects/keyboard-target',agent:{id:'agent-1',name:'builder'},kind:'mode',name:'target-worker',prompt:'Review the target changes'}}).then(reply=>window.startResult=reply);
    return true;
  })()`);
  await page.until("window.startResult?.error?.code === -32003 && document.querySelector('[role=dialog]')?.textContent.includes('target-worker')");
  await page.capture("U5765", "target-start-failure");
  await page.tabTo("Close");
  await page.browser("press", "Enter");
  await page.until("!document.querySelector('[role=dialog]') && document.activeElement?.matches('.ask-input')");
  expect(await page.evaluate("window.startResult.error.message.includes('created-work')")).toBe(true);
});


it("u5765_invalidating_a_pressed_confirmation_cannot_authorize_the_next_request", async () => {
  const sourceB = "/Users/you/Projects/second-source";
  await page.evaluate(`window.__fake.app.nativeOpen({kind:'project',path:'${sourceB}'})`);
  await page.until("[...document.querySelectorAll('[role=tab]')].some(tab => tab.textContent.includes('second-source'))");
  await page.evaluate(`(() => {
    const app = window.__fake.app;
    window.staleResult = null;
    window.nextResult = null;
    void app.requestAction({id:5772,method:'project.open',params:{source:app.opened.project.path,path:'/Users/you/Projects/stale-target'}}).then(reply => window.staleResult=reply);
    void app.of('${sourceB}').requestAction({id:5773,method:'project.open',params:{source:'${sourceB}',path:'/Users/you/Projects/fresh-target'}}).then(reply => window.nextResult=reply);
    return true;
  })()`);
  await page.until("document.querySelector('[role=dialog]')?.textContent.includes('stale-target')");

  const point = await page.evaluate<{ x: number; y: number }>(`(() => {
    const rect = document.querySelector('[role=dialog] button:last-child').getBoundingClientRect();
    return {x:rect.x + rect.width / 2,y:rect.y + rect.height / 2};
  })()`);

  await page.browser("mouse", "move", String(Math.round(point.x)), String(Math.round(point.y)));
  await page.browser("mouse", "down", "left");
  await page.evaluate("window.__fake.app.invalidateActions()");
  await page.until("window.staleResult?.error?.code === -32004 && document.querySelector('[role=dialog]')?.textContent.includes('fresh-target')");
  await page.browser("mouse", "up", "left");
  expect(await page.evaluate("window.nextResult")).toBeNull();
  expect(await page.evaluate("[...document.querySelectorAll('[role=tab]')].some(tab => tab.textContent.includes('fresh-target'))")).toBe(false);
  await page.browser("click", "[role=dialog] button:last-child");
  await page.until("window.nextResult?.result?.path === '/Users/you/Projects/fresh-target' && !document.querySelector('[role=dialog]')");
  expect(await page.evaluate("window.nextResult")).toEqual({jsonrpc:"2.0",id:5773,result:{path:"/Users/you/Projects/fresh-target"}});
});

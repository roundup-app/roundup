import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u3787c-inbox"); }, 180_000);

afterAll(async () => { await lane?.close(); }, 180_000);

it.each(["tree-40", "tabs-8", "conflict"])("u3787c_Inbox_mounted_navigation_selection_and_failure_%s", async seed => {
  await lane.seedTodos(["one", "two", "three", "four", "five"], false, seed);
  const daemon = seed === "tabs-8" ? "window.__fake.app.of('/Users/you/project-number-2')" : "window.__fake.app";
  const dir = captureDir("U3787c");

  if (dir) { mkdirSync(dir, { recursive: true }); await lane.browser("record", "start", join(dir, `inbox-${seed}.webm`)); }

  try {
    await lane.until("!!window.__fake && !!document.querySelector('.rail-row')");

    if (seed === "tabs-8") {
      await lane.browser("focus", '.project-tab[data-path="/Users/you/project-number-2"] [role=tab]');
      await lane.browser("press", "Enter");
      await lane.until("!!document.querySelector('.rail-row[data-id=p2-agent]')");
    }

    await lane.evaluate(`(() => {
      const app = ${daemon};
      app.handlers['todo.unread'] = () => Array.from({length: 5}, (_,i) => ({todo: i+1, title: i<2?'同じ é 🧭':'長い名前 é 🧭 '.repeat(8), comment: {id: 900+i, author: {kind:'agent',id:${JSON.stringify(seed === 'tabs-8' ? 'p2-agent' : 'agent-1')},parent:null}, body:'Review the requested change before continuing.',created_at:0,read:false}}));
      app.emit({actor:{kind:'user',id:'you',parent:null},name:'todo.commented',data:{id:1}});
      return true;
    })()`);
    await lane.browser("set", "media", "dark");
    await lane.browser("press", "Meta+k");
    await lane.browser("press", "i");
    await lane.until("document.querySelectorAll('.inbox [data-collection-value]').length >= 5");
    await lane.capture("U3787c", `inbox-${seed}-before`);
    const ids = await lane.evaluate<string[]>("[...document.querySelectorAll('.inbox [data-collection-value]')].map(el=>el.dataset.collectionValue)");
    await lane.browser("focus", ".inbox [data-collection-value]");
    await lane.evaluate(`(() => { ${daemon}.calls.length = 0; return true; })()`);
    await lane.browser("press", "End");
    expect(await lane.evaluate("document.activeElement.dataset.collectionValue")).toBe(ids.at(-1));
    await lane.browser("press", "ArrowDown");
    expect(await lane.evaluate("document.activeElement.dataset.collectionValue")).toBe(ids.at(-1));
    await lane.browser("press", "Home");
    expect(await lane.evaluate("document.activeElement.dataset.collectionValue")).toBe(ids[0]);
    await lane.capture("U3787c", `inbox-${seed}-focus`);
    await lane.browser("press", "Meta+a");
    expect(await lane.evaluate("[...document.querySelectorAll('.inbox [data-selected=true]')].map(el=>el.dataset.collectionValue)")).toEqual(ids);
    expect(await lane.evaluate(`${daemon}.calls`)).toEqual([]);
    expect(await lane.evaluate("document.querySelector('.inbox [aria-expanded=true]') === null")).toBe(true);
    await lane.capture("U3787c", `inbox-${seed}-selected`);
    // A failed unread refresh retains the selected content and exposes an actionable cause.
    await lane.evaluate(`(() => { const app = ${daemon}; app.handlers['todo.unread']=()=>{throw new Error('Comments unavailable. Retry to load comments.');}; app.emit({actor:{kind:'user',id:'you',parent:null},name:'todo.commented',data:{id:1}}); return true; })()`);
    await lane.until("document.querySelector('.inbox [role=alert]')?.textContent.includes('Comments unavailable. Retry to load comments.')");
    expect(await lane.evaluate("[...document.querySelectorAll('.inbox [data-selected=true]')].map(el=>el.dataset.collectionValue)")).toEqual(ids);
    await lane.evaluate("document.querySelector('.inbox [role=alert]').scrollIntoView({block: 'nearest'})");
    await lane.capture("U3787c", `inbox-${seed}-failure`);
  } finally { if (dir) await lane.browser("record", "stop"); }
}, 180_000);

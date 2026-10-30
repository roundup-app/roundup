import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u3787c-overview-made"); }, 180_000);

afterAll(async () => { await lane?.close(); }, 180_000);

it.skipIf(!captureDir("U3787c")).each(["tree-40", "tabs-8", "conflict"])("u3787c_overview_and_Made_keep_selection_in_the_mounted_App_%s", async seed => {
  await lane.seedTodos(["one", "two", "three", "four", "five"], false, seed);
  const daemon = seed === "tabs-8" ? "window.__fake.app.of('/Users/you/project-number-2')" : "window.__fake.app";
  const dir = captureDir("U3787c");

  if (dir) { mkdirSync(dir, { recursive: true }); await lane.browser("record", "start", join(dir, `overview-made-${seed}.webm`)); }

  try {
    await lane.until("!!window.__fake && !!document.querySelector('[data-todo-root]')");

    if (seed === "tabs-8") {
      await lane.browser("focus", '.project-tab[data-path="/Users/you/project-number-2"] [role=tab]');
      await lane.browser("press", "Enter");
      await lane.until("!!document.querySelector('.rail-row[data-id=p2-agent]')");
    }

    await lane.browser("set", "media", "dark");
    await lane.until("matchMedia('(prefers-color-scheme: dark)').matches");
    await lane.evaluate(`(() => {
      const app = ${daemon};
      const rpc = app.handlers['rail.tree'];
      app.handlers['rail.tree'] = async () => {
        const nodes = await rpc(null);
        const template = nodes.find(node => node.kind === 'agent');
        return [...nodes, ...Array.from({length:5},(_,i)=>({...template,id:'attention-'+i,parent:null,terminal_id:null,name:i<2?'café é 🧭':'Très long é 🧭 '.repeat(8),status:{kind:'needs-you',label:'asks',since:i,finished:'0'}}))];
      };
      app.handlers['deliverable.list'] = () => Array.from({length:5},(_,i)=>({id:'record-'+i,project:'original-project',maker:{kind:'agent',id:'maker',parent:null},maker_name:'Maker',home:null,title:i<2?'café é 🧭':'Très long é 🧭 '.repeat(8),published_at:1792713600000,target:{kind:'external',availability:'not-checked',url:'https://example.com/'+i}}));
      app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      return true;
    })()`);
    // Overview is the production return path from the currently selected Workstream.
    await lane.browser("click", '[data-todo-root]');
    await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page',{detail:{path:document.querySelector('.project-tab[data-selected=true]').dataset.path,command:'view:workstreams'}}))");
    await lane.until("document.querySelectorAll('.overview-entry').length >= 5");

    for (const [selector, opening] of [[".overview-entry", "overview"], [".made-open", "made"]]) {
      if (opening === "made") {
        await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page',{detail:{path:document.querySelector('.project-tab[data-selected=true]').dataset.path,command:'view:made'}}))");
        await lane.until("document.querySelectorAll('.made-open').length === 5 && document.querySelector('.made').getAttribute('aria-busy') === 'false'");
      }

      await lane.capture("U3787c", `${seed}-${opening}-before`);
      await lane.browser("focus", selector!);
      await lane.evaluate(`(() => { ${daemon}.calls.length=0; return true; })()`);
      await lane.browser("press", "End");
      expect(await lane.evaluate(`document.activeElement === [...document.querySelectorAll('${selector}')].at(-1)`)).toBe(true);
      await lane.browser("press", "ArrowDown");
      expect(await lane.evaluate(`document.activeElement === [...document.querySelectorAll('${selector}')].at(-1)`)).toBe(true);
      await lane.browser("press", "Home");
      expect(await lane.evaluate(`document.activeElement === document.querySelector('${selector}')`)).toBe(true);
      await lane.browser("press", "Meta+a");
      expect(await lane.evaluate(`document.querySelectorAll('${selector}[data-row-selected=true]').length`)).toBe(await lane.evaluate(`document.querySelectorAll('${selector}').length`));
      expect(await lane.evaluate(`${daemon}.calls`)).toEqual([]);
      await lane.capture("U3787c", `${seed}-${opening}-selected`);
    }

    await lane.evaluate(`(() => { const app=${daemon}; app.handlers['deliverable.resolve']=()=>{throw new Error('Access refused. Restore Project access, then retry opening.');}; document.querySelector('.made-open').click(); return true; })()`);
    await lane.until("document.querySelector('.made [role=alert]')?.textContent.includes('Restore Project access') && document.querySelector('.made').getAttribute('aria-busy') === 'false'");
    await lane.capture("U3787c", `${seed}-made-failure`);
  } finally { if (dir) await lane.browser("record", "stop"); }
}, 180_000);

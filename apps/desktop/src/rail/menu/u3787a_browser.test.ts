import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../../todos/laneBrowser";
import { captureDir } from "../../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => {
  lane = await openLane(1512, "dark", "rail-u3787a");
  const dir = captureDir("U3787a");

  if (dir) { mkdirSync(dir, { recursive: true }); await lane.browser("record", "start", join(dir, "rail-undo.webm")); }
}, 180_000);

afterAll(async () => {
  try { if (lane && captureDir("U3787a")) await lane.browser("record", "stop"); }
  finally { await lane?.close(); }
}, 180_000);

it("u3787a_rail_feedback_is_immediate_and_conflicts_stay_retryable", async () => {
  for (const seed of ["tree-40", "tabs-8", "conflict", "dense-failure"]) {
    await lane.seedTodos(["same", "same", "long é 🧭 ".repeat(8), "dependent", "fifth"], true, seed === "dense-failure" ? "tree-40" : seed);
    await lane.browser("set", "media", "dark");
    await lane.evaluate(`(async () => {
      const app = window.__fake.app;
      const made = await app.rpc('agent.spawn', {cwd:'/p',parent:null});
      await app.rpc('agent.stop', {id:made.id});
      await app.rpc('rail.rename', {id:made.id,name:'Chosen retained Agent'});
      const originalTree = app.handlers['rail.tree'];
      const before = await originalTree();
      const remove = app.handlers['rail.remove'];
      let receipt = null;
      app.handlers['rail.remove'] = async params => {
        await remove(params);
        return receipt = {removed:[], kept:[], deletion:{project:'capture-project', operation:params.operation, id:params.id, restored:false}};
      };
      app.handlers['rail.deletion'] = () => receipt;
      app.handlers['rail.restore'] = () => {
        if (['conflict','dense-failure'].includes(${JSON.stringify(seed)})) throw new Error('The original Home changed. Restore the Home and retry Undo.');
        app.handlers['rail.tree'] = () => before;
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
        return receipt = {...receipt, deletion:{...receipt.deletion, restored:true}};
      };
      window.__railChosen = made.id;
      return true;
    })()`);
    await lane.until("!!document.querySelector('[data-id=\"' + window.__railChosen + '\"]')");
    await lane.capture("U3787a", `rail-${seed}-before`);
    await lane.evaluate("(() => { const row=document.querySelector('[data-id=\"'+window.__railChosen+'\"] [data-part=branch-control]') ?? document.querySelector('[data-id=\"'+window.__railChosen+'\"]'); row.click(); row.focus(); return true; })()");
    await lane.browser("press", "Meta+Backspace");
    await lane.until("!document.querySelector('[data-id=\"' + window.__railChosen + '\"]')");
    await lane.capture("U3787a", `rail-${seed}-deleted`);
    await lane.evaluate("(() => { const rail=document.querySelector('.rail-tree'); rail.tabIndex=-1; rail.focus(); return true; })()");
    await lane.browser("press", "Meta+z");
    await lane.until((seed === "conflict" || seed === "dense-failure") ? "document.body.textContent.includes('The original Home changed')" : "!!document.querySelector('[data-id=\"'+window.__railChosen+'\"]')");
    expect(await lane.calls("rail.restore")).toHaveLength(1);
    await lane.capture("U3787a", `rail-${seed}-${(seed === "conflict" || seed === "dense-failure") ? "conflict" : "restored"}`);
  }
}, 180_000);


it("u3787a_quiet_deletion_keeps_the_lists_and_drawers_reachable", async () => {
  for (const id of ["U150", "U459", "U460", "U486", "U3512a"]) {
    await lane.seedTodos(["Chosen é 🧭 ".repeat(5), "second", "third", "fourth", "fifth"], true, "tree-40");
    await lane.evaluate(`(() => {
      const row = document.querySelector('.shelf .todo-row-button');
      row.focus();
      return true;
    })()`);

    if (id === "U150" || id === "U3512a") {
      await lane.browser("press", "Enter");
      await lane.until("!!document.querySelector('.todo-detail')");
      await lane.capture(id, "drawer-before");
      await lane.browser("click", '.todo-detail button[aria-label="More actions"]');
      await lane.browser("click", '[role="menuitem"][data-value="delete"]');
      await lane.until("!document.querySelector('.drawer[data-open=true]')");
    } else if (id === "U486") {
      await lane.evaluate(`(async () => {
        await window.__fake.app.rpc('pad.create', {name:'Chosen Pad é 🧭',text:'retained contents'});
        [...document.querySelectorAll('.shelf-tab')].find(tab => tab.textContent.includes('Pads')).click();
        return true;
      })()`);
      await lane.until("!![...document.querySelectorAll('.pads-tab .pad-name')].find(row => row.textContent.includes('Chosen Pad'))");
      await lane.evaluate(`(() => {
        for (const control of document.querySelectorAll('.pads-tab [data-shelf-group] [data-part="branch-control"]')) {
          if (control.closest('[role="treeitem"]')?.getAttribute('aria-expanded') === 'false') control.click();
        }
        return true;
      })()`);
      await lane.until("[...document.querySelectorAll('.pads-tab .pad-name')].some(row => row.textContent.includes('Chosen Pad') && row.getClientRects().length > 0)");
      await lane.evaluate(`(() => {
        const row=[...document.querySelectorAll('.pads-tab .pad-name')].find(row => row.textContent.includes('Chosen Pad'));
        row.focus(); return true;
      })()`);
      await lane.capture(id, "pad-before");
      await lane.browser("press", "d");
      await lane.until("!document.body.textContent.includes('Chosen Pad')");
    } else {
      await lane.capture(id, "list-before");
      await lane.browser("press", "d");
      await lane.until("document.querySelectorAll('.shelf .todo-row').length < 5");
    }

    await lane.capture(id, "deleted-without-feedback");
  }
}, 180_000);

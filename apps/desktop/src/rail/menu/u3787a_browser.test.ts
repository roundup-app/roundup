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
      const made = await app.rpc('rail.createWorkstream', {name:'Chosen retained group',parent:null});
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
    await lane.until("document.body.textContent.includes('Deleted')");
    await lane.capture("U3787a", `rail-${seed}-deleted`);
    await lane.evaluate("(() => { document.activeElement?.blur(); return true; })()");
      await lane.browser("press", "Meta+z");
    await lane.until((seed === "conflict" || seed === "dense-failure") ? "document.body.textContent.includes('The original Home changed')" : "!!document.querySelector('[data-id=\"'+window.__railChosen+'\"]')");
    expect(await lane.calls("rail.restore")).toHaveLength(1);
    await lane.capture("U3787a", `rail-${seed}-${(seed === "conflict" || seed === "dense-failure") ? "conflict" : "restored"}`);
  }
}, 180_000);

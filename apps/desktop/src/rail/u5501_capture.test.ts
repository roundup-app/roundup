import { afterAll, beforeAll, it } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { if (captureDir("U5501")) lane = await openLane(1512, "dark", "u5501"); }, 60_000);

afterAll(async () => { await lane?.close(); }, 60_000);

it.skipIf(!captureDir("U5501")).each(["tree-40", "agents-10"])("u5501_rendered_levels_held_and_refusal %s", async seed => {
  const dir = captureDir("U5501")!;
  mkdirSync(dir, { recursive: true });
  await lane.browser("record", "start", join(dir, `${seed}.webm`));

  try {
    await lane.seedTodos(["Review", "Ship"], false, seed);
    await lane.browser("set", "media", "dark");
    await lane.evaluate(`(async () => {
      const app = window.__fake.app;
      const nodes = await app.rpc('rail.tree', null);
      const agents = nodes.filter(node => node.kind === 'agent' || node.attempt !== null);
      agents.forEach((node, i) => { node.alert_level = i % 3 === 0 ? 'quiet' : i % 3 === 1 ? 'all' : 'default'; });
      agents[0].name = 'Review the compatibility of the production release with the existing Project';
      app.handlers['rail.tree'] = () => structuredClone(nodes);
      app.emit({ actor: {kind:'user',id:'you',parent:null}, name:'rail.changed' });
      return true;
    })()`);
    await lane.until("!!document.querySelector('[data-state=alert-level]')");
    await lane.evaluate(`(() => {
      const app = window.__fake.app;
      const nodes = app.handlers['rail.tree']();
      for (const node of nodes.filter(node => node.alert_level === 'quiet').slice(0, 3)) {
        window.__fake.setStatus(node.id, 'error', 'Review the original Terminal before continuing');
      }
      return true;
    })()`);
    await lane.until("!!document.querySelector('.rail-footer .disclosure-trigger')");
    await lane.evaluate("document.querySelector('.rail-footer .disclosure-trigger').click()");
    await lane.until("!!document.querySelector('.held-row')");
    await lane.evaluate(`(async () => {
      const app = window.__fake.app;
      app.handlers['rail.setAlertLevel'] = () => { throw new Error('The level could not be saved. Try again.'); };
      document.querySelector('.rail-row[data-id]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, clientX:120, clientY:180}));
      await app.pickMenu('Quiet');
      return true;
    })()`);
    await lane.until("document.body.textContent.includes('The level could not be saved')");
    await lane.capture("U5501", `${seed}-held-refused`);
  } finally { await lane.browser("record", "stop"); }
}, 60_000);

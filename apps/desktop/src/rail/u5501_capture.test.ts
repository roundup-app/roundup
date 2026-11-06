import { afterAll, beforeAll, it } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { if (captureDir("U5501") || captureDir("U5721")) lane = await openLane(1512, "dark", "u5501"); }, 60_000);

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


it.skipIf(!captureDir("U5721"))("u5721_rendered_workstream_selection_and_failed_open", async () => {
  const dir = captureDir("U5721")!;
  mkdirSync(dir, { recursive: true });
  await lane.browser("record", "start", join(dir, "selection.webm"));

  try {
    await lane.browser("set", "media", "dark", "reduced-motion");
    await lane.until("!!document.querySelector('.rail-row[data-id]')");
    await lane.evaluate(`(async () => {
      const app = window.__fake.app;
      const nodes = await app.rpc('rail.tree', null);
      const door = nodes.find(node => node.kind === 'workstream' && node.attempt !== null && node.terminal_id);
      if (!door) throw new Error('tree-40 has no live Door');
      nodes.forEach(node => { node.alert_level = 'quiet'; });
      door.name = 'Review the compatibility of the production release with the existing Project';
      window.__alertDoor = door.id;
      window.__alertTerminal = door.terminal_id;
      app.handlers['rail.tree'] = () => structuredClone(nodes);
      app.emit({ actor: {kind:'user',id:'you',parent:null}, name:'rail.changed' });
      return true;
    })()`);
    await lane.until("!!document.querySelector('[data-state=alert-level]')");
    await lane.evaluate("window.__fake.setStatus(window.__alertDoor, 'working', 'Reviewing')");
    await lane.evaluate("window.__fake.setStatus(window.__alertDoor, 'needs-you', 'Review the original Terminal before continuing with the release and confirm compatibility with the existing Project')");
    await lane.until("!!document.querySelector('.rail-footer .disclosure-trigger')");
    await lane.browser("mouse", "move", "1100", "900");
    await lane.capture("U5721", "first-load-before");
    await lane.browser("click", ".rail-footer .disclosure-trigger");
    await lane.until("!!document.querySelector('.held-row')");
    await lane.evaluate("document.querySelector('.rail-row[data-id=\"' + window.__alertDoor + '\"]').click()");
    await lane.until("window.__fake.app.calls.some(call => call.method === 'terminal.snapshot' && call.params.id === window.__alertTerminal)");
    await lane.browser("mouse", "move", "1100", "900");
    await lane.capture("U5721", "first-load-after");
    await lane.evaluate("document.querySelector('.rail-row[data-id=\"' + window.__alertDoor + '\"]').click()");
    await lane.browser("mouse", "move", "1100", "900");
    await lane.capture("U5721", "mounted-after");
    await lane.evaluate(`(() => {
      window.__fake.app.handlers['terminal.snapshot'] = () => { throw new Error('Terminal unavailable. Try again.'); };
      window.__fake.app.handlers['terminal.catchUp'] = () => { throw new Error('Terminal unavailable. Try again.'); };
      document.querySelector('.held-row').click();
      return true;
    })()`);
    await lane.until("document.body.textContent.includes('Terminal unavailable')");
    await lane.browser("mouse", "move", "1100", "900");
    await lane.capture("U5721", "failed-open");
  } finally { await lane.browser("record", "stop"); }
}, 60_000);

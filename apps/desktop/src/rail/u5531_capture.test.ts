import { afterAll, beforeAll, expect, it } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u5531"); }, 60_000);

afterAll(async () => { await lane?.close(); });

it.each(["agents-10", "tree-40"])("u5531b_keyboard_and_click_walk_internal_children %s", async seed => {
  const directory = captureDir("U5531b");

  if (directory) { mkdirSync(directory, { recursive: true }); await lane.browser("record", "start", join(directory, `${seed}.webm`)); }

  try {
    await lane.seedTodos([], false, seed);
    await lane.browser("set", "media", "dark");
    await lane.until("typeof window.__checks === 'function'");
    await lane.capture("U5531b", `${seed}-before`);

    if (process.env["ROUNDUP_CAPTURE_PHASE"] === "base") return;
    await lane.evaluate(`(async () => {
      const app = window.__fake.app;
      const nodes = await app.rpc('rail.tree', null);
      const home = nodes.find(node => node.kind === 'workstream') ?? await app.rpc('rail.createWorkstream', {name:'Helpers',parent:null});
      if (!nodes.some(node => node.id === home.id)) nodes.push(home);
      const children = nodes.filter(node => node.kind === 'agent').slice(0, 4);
      children.forEach((node, index) => {
        node.parent = home.id; node.order = index;
        node.visibility = index < 2 ? 'internal' : 'shown';
        node.status = {kind: index === 3 ? 'done' : 'working', label: 'working', since: Date.now(), finished:'0'};
        node.final_text = index === 3 ? {attempt:node.attempt,turn:'1',finished:'0',kind:'empty'} : undefined;
      });
      children[1].status.kind = 'done';
      children[1].final_text = {attempt:children[1].attempt,turn:'1',finished:'0',kind:'empty'};
      children[0].name = 'Review compatibility with the existing production release';
      window.__u5531 = {home:home.id,child:children[0].id};
      app.handlers['rail.tree'] = () => structuredClone(nodes);
      app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      return true;
    })()`);
    await lane.until("!!document.querySelector('[data-id=\"fold:internal:' + window.__u5531.home + '\"]')");
    const branch = await lane.evaluate<string>("'fold:internal:' + window.__u5531.home");
    const control = `[data-id="${branch}"] [data-part=branch-control]`;
    await lane.capture("U5531b", `${seed}-closed`);
    await lane.browser("click", control);
    await lane.until("!!document.querySelector('[data-id=\"' + window.__u5531.child + '\"]')");
    await lane.capture("U5531b", `${seed}-open`);
    await lane.browser("click", control);
    await lane.browser("focus", control);
    await lane.browser("press", "ArrowRight");
    await lane.browser("press", "ArrowRight");
    expect(await lane.evaluate("document.activeElement.closest('[data-id]').dataset.id")).toBe(await lane.evaluate("window.__u5531.child"));
    await lane.browser("press", "ArrowLeft");
    expect(await lane.evaluate("document.activeElement.closest('[data-id]').dataset.id")).toBe(branch);
    await lane.browser("press", "ArrowLeft");
    await lane.until("!document.querySelector('[data-id=\"' + window.__u5531.child + '\"]')");
    await lane.capture("U5531b", `${seed}-reclosed`);
    const idle = await lane.evaluate<string>("'fold:' + window.__u5531.home");
    await lane.browser("click", `[data-id="${idle}"] [data-part=branch-control]`);
    await lane.capture("U5531b", `${seed}-idle-open`);
    await lane.browser("click", `[data-id="${idle}"] [data-part=branch-control]`);
    await lane.evaluate(`(() => {
      const app=window.__fake.app; const nodes=app.handlers['rail.tree']();
      const child=nodes.find(node=>node.id===window.__u5531.child);
      child.visibility='shown'; child.status.kind='needs-you'; child.status.label='Review the command in this Agent’s Terminal, then approve or refuse it.';
      app.handlers['rail.tree']=()=>structuredClone(nodes);
      app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'}); return true;
    })()`);
    await lane.until("!!document.querySelector('[data-id=\"' + window.__u5531.child + '\"][data-kind=needs-you]')");
    await lane.capture("U5531c", `${seed}-attention-return`);
    await lane.evaluate("window.__fake.setStatus(window.__u5531.child, 'error', 'Command failed. Open this Agent’s Terminal to inspect the cause, then retry the command.')");
    await lane.capture("U5531c", `${seed}-failure`);
    expect(await lane.evaluate("window.__fake.app.calls.filter(call => ['agent.stop','agent.resume','agent.spawn','terminal.write'].includes(call.method)).length")).toBe(0);
  } finally { if (directory) await lane.browser("record", "stop"); }
}, 60_000);

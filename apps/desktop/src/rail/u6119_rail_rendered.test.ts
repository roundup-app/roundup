import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u6119"); }, 60_000);

afterAll(async () => { await lane?.close(); });

const dots = (id: string) => lane.evaluate<number>(`document.querySelectorAll('[role=treeitem][data-id="${id}"] .unread-dot').length`);

it("u6119_rail_rendered", async () => {
  await lane.seedTodos([], false, "agents-10");
  await lane.browser("set", "media", "dark");
  await lane.until("typeof window.__checks === 'function'");
  await lane.evaluate(`(async () => {
    const app = window.__fake.app;
    const nodes = await app.rpc('rail.tree', null);
    const base = nodes.find(node => node.kind === 'agent');
    const door = { ...structuredClone(base), id: 'u6119-door', kind: 'workstream', parent: null, order: 0, name: 'Coordinate the production release across every region and every service owner', terminal_id: null };
    const children = Array.from({ length: 10 }, (_, index) => ({ ...structuredClone(base), id: 'u6119-child-' + index, parent: door.id, order: index, name: 'child ' + index, terminal_id: null,
      status: { kind: 'working', label: 'working', since: Date.now(), finished: '0' } }));
    const top = { ...structuredClone(base), id: 'u6119-top', parent: null, order: 1, name: 'top-level agent', terminal_id: null, status: { kind: 'working', label: 'working', since: Date.now(), finished: '0' } };
    const tree = [door, ...children, top];
    window.__u6119 = tree;
    app.handlers['rail.tree'] = () => structuredClone(window.__u6119);
    app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
    return true;
  })()`);
  await lane.until("!!document.querySelector('[data-id=\"u6119-child-9\"]') && !!document.querySelector('[data-id=\"u6119-top\"]')");
  await lane.capture("U6119b", "before");

  const finish = (id: string) => lane.evaluate(`(() => {
    const node = window.__u6119.find(node => node.id === '${id}');
    node.status = { kind: 'idle', label: 'finished', since: Date.now(), finished: '1' };
    window.__fake.app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
    return true;
  })()`);

  // Nothing is selected on the children, so a finish elsewhere would be unseen.
  await lane.browser("click", "[data-id=\"u6119-top\"]");

  for (let index = 0; index < 10; index += 1) await finish(`u6119-child-${index}`);

  await lane.browser("click", "[data-id=\"u6119-top\"]");
  await finish("u6119-door");
  await lane.until("document.querySelectorAll('[data-id=\"u6119-door\"] .unread-dot').length === 1");

  for (let index = 0; index < 10; index += 1) expect(await dots(`u6119-child-${index}`)).toBe(0);
  await lane.capture("U6119b", "after");
}, 120_000);

import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u6228"); }, 60_000);

afterAll(async () => { await lane?.close(); });

it("u6228_rendered_strip_collapsed_and_worst_case", async () => {
  await lane.until("!!document.querySelector('.rail-collapse')");
  await lane.browser("click", ".rail-collapse");
  await lane.until("document.querySelector('.rail').dataset.collapsed === 'true' && !!document.querySelector('.rail-mark')");
  await lane.capture("U6228a", "collapsed");

  // Worst case: forty Workstreams, one with a 300-character name.
  await lane.evaluate(`(async () => {
    const app = window.__fake.app;
    const nodes = await app.rpc('rail.tree', null);
    const door = nodes.find(node => node.kind === 'workstream');
    door.name = 'W'.repeat(300);
    const extra = Array.from({ length: 40 }, (_, index) => ({ ...structuredClone(door), id: 'u6228-ws-' + index, order: 100 + index, name: 'Workstream ' + index }));
    window.__u6228 = [...nodes, ...extra];
    app.handlers['rail.tree'] = () => structuredClone(window.__u6228);
    app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
    return true;
  })()`);
  await lane.until("[...document.querySelectorAll('.rail-mark')].some(mark => mark.getAttribute('aria-label')?.startsWith('WWWW'))");
  await lane.capture("U6228a", "worst-case");

  // The peek over the centre, at the worst case's strip.
  await lane.browser("hover", ".rail-mark");
  await lane.until("document.querySelector('.rail').dataset.peek === 'true'");
  await lane.until("document.querySelector('.rail-body').getAnimations().every(animation => animation.playState === 'finished')");
  await lane.capture("U6228a", "peeking");

  expect(await lane.evaluate<boolean>("document.querySelector('.rail').dataset.collapsed === 'true'")).toBe(true);
}, 120_000);

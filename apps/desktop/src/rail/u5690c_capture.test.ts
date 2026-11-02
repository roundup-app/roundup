import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, it, expect } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u5690c"); }, 60_000);

afterAll(async () => { await lane?.close(); }, 60_000);

it("u5690c_rendered_group_keeps_children_reachable_without_lifecycle_actions", async () => {
  await lane.seedTodos([], false, "tree-40");
  const dir = captureDir("U5690c");

  if (dir) {
    mkdirSync(dir, { recursive: true });
    await lane.browser("record", "restart", join(dir, "group-adapter.webm"));
  }

  try {
    await lane.capture("U5690c", "existing-tree");
    await lane.evaluate(`(async () => {
      const app = window.__fake.app;
      const nodes = await app.rpc('rail.tree', null);
      const group = nodes.find(node => node.parent === null && node.kind === 'workstream');
      group.kind = 'group'; group.name = 'Organized work '.padEnd(60, 'x');
      group.status = null; group.work = null; group.attempt = null; group.terminal_id = null;
      app.handlers['rail.tree'] = () => nodes;
      app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      return true;
    })()`);
    await lane.until("!![...document.querySelectorAll('.rail-row')].find(row => row.textContent.includes('Organized work'))");
    const row = '.rail-row:has-text("Organized work")';
    await lane.browser("dblclick", `${row} .name`);
    await lane.capture("U5690c", "group-name");
    await lane.evaluate("window.__fake.failNext(-32003, 'Group rename refused; try again'); true");
    await lane.browser("fill", '[aria-label="Name"]', "Retained Group name");
    await lane.browser("press", "Enter");
    await lane.until("!!document.querySelector('.failure-line, [role=alert]')");
    await lane.capture("U5690c", "group-failure");
    await lane.browser("press", "Escape");
    await lane.capture("U5690c", "group-rest");
    expect((await lane.calls()).filter(call => ['agent.spawn','rail.startDoor','agent.resume','agent.stop'].includes(call.method))).toEqual([]);
  } finally { if (dir) await lane.browser("record", "stop"); }
}, 60_000);

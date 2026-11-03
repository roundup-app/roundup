import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer, mergeConfig } from "vite";
import { afterAll, beforeAll, it, expect } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { appServer } from "../testing/appServer";
import { createServedApp } from "../testing/realSeam";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u5690c", false, null); }, 60_000);

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

    const groupId = await lane.evaluate<string>(`(async () => {
      const app = window.__fake.app;
      const nodes = await app.rpc('rail.tree', null);
      const group = nodes.find(node => node.parent === null && node.kind === 'workstream');
      group.kind = 'group'; group.name = 'Organized work '.padEnd(60, 'x');
      group.status = null; group.work = null; group.attempt = null; group.terminal_id = null;
      app.handlers['rail.tree'] = () => nodes;
      app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      return group.id;
    })()`);

    await lane.until("!![...document.querySelectorAll('.rail-row')].find(row => row.textContent.includes('Organized work'))");
    await lane.browser("dblclick", `[id="rail-name-${groupId}"]`);
    await lane.capture("U5690c", "group-name");
    await lane.evaluate("window.__fake.failNext(-32003, 'Group rename refused; try again'); true");
    await lane.browser("fill", '[aria-label="Name"]', "Retained Group name");
    await lane.browser("press", "Enter");
    await lane.until("!!document.querySelector('.failure-line, [role=alert]')");
    await lane.capture("U5690c", "group-failure");
    await lane.browser("press", "Escape");
    await lane.capture("U5690c", "group-rest");
    await lane.browser("click", `[data-id="${groupId}"] .rail-group-chevron`);
    await lane.until(`!document.querySelector('[data-id="auth"]')`);
    await lane.capture("U5690c", "group-collapsed");
    expect(await lane.evaluate(`document.querySelector('[data-id="${groupId}"] .glyph').getAttribute('aria-label')`)).toBe("Error");
    await lane.browser("click", `[data-id="${groupId}"] .rail-group-chevron`);
    await lane.until(`!!document.querySelector('[data-id="auth"]')`);
    await lane.capture("U5690c", "group-click-expanded");
    await lane.browser("click", `[id="rail-name-${groupId}"]`);
    await lane.capture("U5690c", "group-centre");
    expect((await lane.calls()).filter(call => ['agent.spawn','rail.startDoor','agent.resume','agent.stop'].includes(call.method))).toEqual([]);
  } finally { if (dir) await lane.browser("record", "stop"); }
}, 60_000);


it("u5690c_public_group_renders_and_opens_its_children", async () => {
  const frontend = await appServer();

  const real = await startRealDaemon({}, false, {
    spawn,
    // CI 41639412981 spent 49.8 s here: reuse the compiled App while keeping
    // this Project's /__daemon routes on its own server and origin.
    createServer: config => createServer(mergeConfig(config ?? {}, { server: {
      proxy: { "^/(?!__daemon(?:/|$))": frontend.resolvedUrls.local[0]! },
    } })),
  });

  try {
    const app = createServedApp(real.base);
    const nodes = [];

    for (let index = 0; index < 40; index += 1) nodes.push(await app.rpc("rail.createWorkstream", { name: `Review ${index + 1}`, parent: null }));
    const group = await app.rpc("rail.group", { ids: nodes.slice(0, 5).map(node => node.id) });
    await app.rpc("rail.rename", { id: group.id, name: "Organized work" });
    await lane.browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await lane.until(`!!document.querySelector('[id="rail-name-${group.id}"]')`);
    await lane.browser("click", `[id="rail-name-${group.id}"]`);
    await lane.until("!!document.querySelector('.pane-group h3')");
    await lane.capture("U5690c", "public-group-centre");
    await lane.browser("click", `[data-id="${group.id}"] .rail-group-chevron`);
    await lane.until(`!document.querySelector('[id="rail-name-${nodes[0]!.id}"]')`);
    await lane.capture("U5690c", "public-group-collapsed");
    await lane.browser("click", `[data-id="${group.id}"] .rail-group-chevron`);
    await lane.until(`!!document.querySelector('[id="rail-name-${nodes[0]!.id}"]')`);
    await lane.browser("click", '.pane-group button:first-of-type');
    await lane.until("!document.querySelector('.pane-group button')?.textContent.includes('Review 1')");
    expect(await app.rpc("terminal.list", null)).toEqual([]);
    expect((await app.rpc("rail.tree", null)).find(node => node.id === group.id)?.kind).toBe("group");
    await lane.capture("U5690c", "public-group-child");
  } finally {
    await real.stop();
    await frontend.close();
  }
}, 360_000);

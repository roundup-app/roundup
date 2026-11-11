import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u4547a"); }, 180_000);

afterAll(async () => { await lane?.close(); }, 180_000);

it("u4547a_rendered_heading_keys_preserve_focus_without_calls", async () => {
  await lane.seedTodos([], false, "agents-10");
  await lane.evaluate(`(async () => {
    const app = window.__fake.app;
    const agents = await app.rpc('rail.tree', null);
    const plain = await app.rpc('rail.createWorkstream', { name: 'Product work', parent: null });
    const mode = await app.rpc('agent.createMode', { name: 'Review changes', prompt: 'Review the current changes' });
    for (const [index, agent] of agents.filter(node => node.kind === 'agent').entries()) {
      if (index < 4) await app.rpc('rail.move', { id: agent.id, parent: plain.id, index });
    }
    for (let index = 0; index < 2; index++) {
      await app.rpc('agent.spawn', { cwd: app.opened.project.path, parent: mode.id, name: 'reviewer-' + index, prompt: null, model: null, effort: null });
    }
    return true;
  })()`);
  await lane.until("document.querySelectorAll('.rail-tree .section-head').length === 3");
  await lane.capture("U4547a", "mixed-ten-agents");
  await lane.resetCalls();
  await lane.browser("focus", ".rail-tree .section-head");

  for (const [key, expanded] of [["Enter", false], ["Space", true], ["ArrowLeft", false], ["ArrowLeft", false], ["ArrowRight", true], ["ArrowRight", true]] as const) {
    await lane.browser("press", key);
    await lane.until(`document.activeElement?.matches('.section-head') && document.activeElement.getAttribute('aria-expanded') === '${expanded}'`);
    expect(await lane.evaluate<string[]>("[...document.querySelectorAll('.rail-tree .section-head')].map(head => head.getAttribute('aria-expanded'))"))
      .toEqual([String(expanded), "true", "true"]);

    if (key === "Enter") await lane.capture("U4547a", "workstreams-collapsed");
  }

  expect(await lane.calls()).toEqual([]);
  await lane.browser("press", "ArrowDown");
  await lane.until("document.activeElement?.getAttribute('data-id') !== null && document.activeElement?.closest('[role=treeitem]')?.getAttribute('aria-level') === '2'");
  await lane.browser("press", "ArrowUp");
  await lane.until("document.activeElement?.matches('.section-head') === true");
  await lane.browser("press", "End");
  await lane.until("document.activeElement?.getAttribute('data-id') !== null");
  await lane.browser("press", "Home");
  await lane.until("document.activeElement?.matches('.section-head') === true");
  expect(await lane.evaluate("document.activeElement.closest('[role=treeitem]').getAttribute('aria-level')")).toBe("1");
  expect(await lane.calls()).toEqual([]);
  await lane.capture("U4547a", "reopened");
  await lane.evaluate("window.__fake.failNext(-32003, 'Workstream could not be created. Try again.')");
  await lane.browser("click", ".rail-actions button");
  await lane.until("!!document.querySelector('.rail-create-menu [data-value=workstream]')");
  await lane.browser("click", '.rail-create-menu [data-value="workstream"]');
  await lane.until("document.querySelector('[role=alert]')?.textContent.includes('Workstream could not be created')");
  await lane.capture("U4547a", "dense-failure");

  if (captureDir("U4547a")) {
    const saved = await lane.evaluate<unknown[]>("window.__fake.app.rpc('rail.tree', null)");

    for (const kind of ["workstreams", "modes", "agents", "empty"]) {
      await lane.evaluate(`(() => {
        const saved = ${JSON.stringify(saved)};
        const rows = saved.filter(row => row.parent === null && (${JSON.stringify(kind)} === 'agents' ? row.kind === 'agent' : ${JSON.stringify(kind)} === 'modes' ? !!row.mode_prompt?.trim() : ${JSON.stringify(kind)} === 'workstreams' ? row.kind === 'workstream' && !row.mode_prompt?.trim() : false));
        window.__fake.app.handlers['rail.tree'] = () => rows;
        window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'rail.changed' });
        return true;
      })()`);
      await lane.until(`document.querySelectorAll('.rail-tree .section-head').length === ${kind === "empty" ? 0 : 1}`);
      await lane.capture("U4547a", kind);
    }
  }
}, 180_000);

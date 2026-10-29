import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u4547d"); }, 60_000);

afterAll(async () => { await lane?.close(); }, 60_000);

it("u4547d_rendered_restart_and_refusal_keep_the_mode_reachable", async () => {
  await lane.seedTodos([], false, "tree-40");
  await lane.capture("U4547d", "before");

  const id = await lane.evaluate<string>(`(async () => {
    const mode = await window.__fake.app.rpc('rail.createWorkstream', { name: 'Review the current changes and preserve all the work', parent: null });
    await window.__fake.app.rpc('workstream.setOpeningPrompt', { id: mode.id, prompt: '  Review é 🧭\\nKeep exact spacing  ' });
    return mode.id;
  })()`);

  const row = `.rail-row[data-id="${id}"]`;
  await lane.until(`document.querySelector(${JSON.stringify(row)}) !== null`);
  await lane.browser("focus", row);
  await lane.capture("U4547d", "stopped-mode");
  await lane.evaluate(`(() => {
    const restart = window.__fake.app.handlers['workstream.restart'];
    let refused = false;
    let started;
    window.__fake.app.handlers['workstream.restart'] = params => {
      if (!refused) { refused = true; throw new Error('Door could not start. Restore Claude, then retry.'); }
      return started ??= restart(params);
    };
    return true;
  })()`);
  await lane.browser("click", `${row} [aria-label=Restart]`);
  await lane.until("document.querySelector('[role=alert]')?.textContent.includes('Door could not start')");
  await lane.capture("U4547d", "dense-restart-failure");
  await lane.browser("click", '.rail-command-notice button');
  await lane.until("!document.querySelector('.rail-command-notice [role=alert]')");
  const calls = await lane.calls("workstream.restart");
  expect(calls).toHaveLength(2);
  expect(calls[1]!.params).toEqual(calls[0]!.params);
  await lane.capture("U4547d", "retry-running");
  await lane.browser("focus", row);
  await lane.browser("press", "r");
  await lane.until("window.__fake.app.calls.filter(call => call.method === 'workstream.restart').length === 3");
  await lane.until(`document.querySelector(${JSON.stringify(`${row} [aria-label=Restart]`)})?.getAttribute('aria-disabled') !== 'true'`);
  await lane.browser("click", `${row} button[aria-label='Row actions']`);
  await lane.until("window.__fake.app.menuLabels().includes('Restart')");
  await lane.evaluate("window.__fake.app.pickMenu('Restart')");
  await lane.until("window.__fake.app.calls.filter(call => call.method === 'workstream.restart').length === 4");
  expect(await lane.calls("agent.resume")).toEqual([]);
}, 60_000);

import { mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u4547bc"); }, 180_000);

afterAll(async () => { await lane?.close(); }, 180_000);

it("u4547b_rendered_creation_and_failure_remain_actionable", async () => {
  const recording = captureDir("U4547b");

  if (recording) {
    mkdirSync(recording, { recursive: true });
    await lane.browser("record", "restart", join(recording, "create-and-edit-mode.webm"));
  }

  await lane.browser("set", "media", "dark");
  await lane.seedTodos([], false, "agents-10");
  await lane.capture("U4547b", "agents-10-rest");
  await lane.seedTodos([], false, "tree-40");
  await lane.capture("U4547b", "understand-before");
  await lane.browser("click", '[aria-label="New Mode"]');
  await lane.until("document.querySelector('[role=dialog]') !== null");
  await lane.capture("U4547b", "blank-fields");
  await lane.browser("fill", '[data-part=input]', "Reviewer");
  await lane.browser("fill", '.opening-prompt-field textarea', "  Review the current changes\nKeep exact spacing  ");
  await lane.capture("U4547b", "enter");
  await lane.evaluate("window.__fake.failNext(-32003, 'Mode could not be created. Retry with your saved input.')");
  await lane.browser("click", 'button[type=submit]');
  await lane.until("document.querySelector('[role=alert]')?.textContent.includes('Mode could not be created')");
  await lane.capture("U4547b", "intervene-failure");
  await lane.browser("click", 'button[type=submit]');
  await lane.until("!document.querySelector('[role=dialog]')");
  await lane.until("[...document.querySelectorAll('.rail-tree .section-head')].some(head => head.textContent.includes('MODES'))");
  await lane.until("document.activeElement?.closest('[data-id]')?.getAttribute('data-id') === window.__fake.app.calls.find(call => call.method === 'workstream.restart').params.id");
  await lane.capture("U4547b", "selected-mode");

  const calls = await lane.calls();
  expect(calls.filter(call => call.method === "workstream.restart")).toHaveLength(1);
  const id = await lane.evaluate<string>("window.__fake.app.calls.find(call => call.method === 'workstream.restart').params.id");
  await lane.evaluate(`(async () => {
    const other = await window.__fake.app.rpc('rail.createWorkstream', { name: 'Reviewer with a deliberately long name', parent: null });
    await window.__fake.app.rpc('workstream.setOpeningPrompt', { id: other.id, prompt: 'Review the work' });
    return true;
  })()`);
  await lane.until("document.querySelectorAll('.rail-section[aria-label=MODES] .rail-row').length === 2");
  await lane.browser("click", '.rail-row[data-id="backend"]');
  await lane.browser("hover", '[aria-label="New Mode"]');
  await lane.capture("U4547b", "mode-names-at-rest");
  await lane.browser("hover", '.rail-row[data-id="' + id + '"]');
  await lane.capture("U4547b", "hovered-mode");
  await lane.browser("focus", '.rail-row[data-id="' + id + '"]');
  await lane.until(`document.activeElement?.getAttribute('data-id') === ${JSON.stringify(id)}`);
  await lane.browser("press", "Shift+F10");
  await lane.until("window.__fake.app.menuLabels().includes('First prompt…')");
  await lane.evaluate("window.__fake.app.pickMenu('First prompt…')");
  await lane.until("document.querySelector('.opening-prompt-dialog textarea') !== null");
  await lane.capture("U4547c", "edit-first-prompt");
  await lane.browser("fill", '.opening-prompt-field textarea', "  changed prompt\n ");
  await lane.evaluate("window.__fake.failNext(-32003, 'First prompt could not be saved. Retry with your draft.')");
  await lane.browser("click", '[data-part=title]');
  await lane.until("document.querySelector('[role=alert]')?.textContent.includes('First prompt could not be saved')");
  await lane.capture("U4547c", "intervene-save-failure");

  if (recording) {
    await lane.browser("record", "stop");
    const editing = captureDir("U4547c");

    if (editing) copyFileSync(join(recording, "create-and-edit-mode.webm"), join(editing, "create-and-edit-mode.webm"));
  }

}, 180_000);

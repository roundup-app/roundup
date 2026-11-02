import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, it, expect } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => {
  lane = await openLane(1512, "dark", "u5555");
  const recording = captureDir("U5555");

  if (recording) {
    mkdirSync(recording, { recursive: true });
    await lane.browser("record", "restart", join(recording, "creation.webm"));
  }
}, 60_000);

afterAll(async () => {
  try { if (captureDir("U5555")) await lane?.browser("record", "stop"); }
  finally { await lane?.close(); }
}, 60_000);

const fresh = async (seed: string) => {
  await lane.seedTodos([], false, seed);
  await lane.evaluate("(async () => { const { saveAppSettings } = await import('/src/settings/preferences.ts'); await saveAppSettings({ mode: 'dark' }); return true; })()");
};

const kinds = ["agent", "workstream", "mode"];

const cases = ["empty-project", "tree-40"].flatMap(seed => kinds.map((kind, index) => ({ seed, kind, index, chord: ["Meta+n", "Alt+Meta+n", "Shift+Meta+m"][index]! })));

it.each(cases)("u5217_rendered_menu_matches_chord $seed $kind", async ({ seed, kind, chord }) => {
  const outcomes = [];

  for (const menu of [false, true]) {
    await fresh(seed);

    if (menu) {
      await lane.browser("click", '[aria-label="Create"]');
      await lane.until("!!document.querySelector('[role=menu]')");
      expect(await lane.evaluate("[...document.querySelectorAll('[role=menuitem]')].map(item => [item.dataset.value, item.getAttribute('aria-keyshortcuts'), item.querySelector('kbd').textContent])")).toEqual([
        ["agent", "Meta+N", "⌘N"], ["workstream", "Alt+Meta+N", "⌥⌘N"], ["mode", "Shift+Meta+M", "⇧⌘M"],
      ]);
      expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toEqual([]);

      if (kind === "agent") await lane.capture("U5217", `${seed}-menu`);
      await lane.browser("click", `[role=menuitem][data-value=${kind}]`);
    } else await lane.browser("press", chord);
    await lane.until(kind === "mode" ? "!!document.querySelector('[role=dialog]')" : "window.__fake.app.calls.some(call => ['agent.spawn','rail.createWorkstream'].includes(call.method))");
    await lane.until("!document.querySelector('[role=menu]')");
    outcomes.push(await lane.evaluate("({ calls: window.__fake.app.calls.filter(call => ['agent.spawn','rail.createWorkstream'].includes(call.method)).map(call => ({method:call.method,params:call.params})), selection: document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id'), dialog: !!document.querySelector('[role=dialog]'), focus: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.getAttribute('data-id') })"));
  }

  expect(outcomes[1]).toEqual(outcomes[0]);
}, 60_000);

it.each(cases)("u5555_rendered_keyboard_chooses $seed $kind", async ({ seed, kind, index }) => {
  await fresh(seed);
  await lane.browser("focus", '[aria-label="Create"]');
  await lane.browser("press", "Shift+Tab");
  await lane.browser("press", "Tab");
  expect(await lane.focused()).toBe("Create");
  await lane.browser("press", index % 2 ? "Space" : "Enter");
  await lane.until("!!document.querySelector('[role=menu]')");
  await lane.browser("press", "Home");
  await lane.until("document.querySelector('[role=menuitem][data-highlighted]')?.dataset.value === 'agent'");
  await lane.browser("press", "ArrowDown");
  await lane.until("document.querySelector('[role=menuitem][data-highlighted]')?.dataset.value === 'workstream'");
  await lane.browser("press", "ArrowUp");
  await lane.until("document.querySelector('[role=menuitem][data-highlighted]')?.dataset.value === 'agent'");
  await lane.browser("press", "Escape");
  await lane.until("!document.querySelector('[role=menu]') && document.activeElement?.getAttribute('aria-label') === 'Create'");
  expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toEqual([]);
  await lane.capture("U4313b", `${seed}-rest`);
  await lane.browser("press", "Space");
  await lane.until("!!document.querySelector('[role=menu]')");
  await lane.browser("press", "Home");

  for (let step = 0; step < index; step++) await lane.browser("press", "ArrowDown");
  await lane.until(`document.querySelector('[role=menuitem][data-highlighted]')?.dataset.value === '${kind}'`);
  await lane.browser("press", "Enter");
  await lane.until(kind === "mode" ? "!!document.querySelector('[role=dialog]')" : "window.__fake.app.calls.some(call => ['agent.spawn','rail.createWorkstream'].includes(call.method))");
  expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toHaveLength(kind === "mode" ? 0 : 1);
}, 60_000);

it("u5555_rendered_unavailable_menu_and_failure_retry", async () => {
  await fresh("tree-40");
  await lane.browser("click", '[aria-label="Create"]');
  await lane.until("!!document.querySelector('[role=menu]')");
  await lane.evaluate("window.__fake.app.exitDaemon({code:1}); true");
  await lane.until("document.querySelectorAll('[role=menuitem][aria-disabled=true]').length === 3");
  await lane.capture("U5555", "unavailable");
  await lane.browser("press", "Enter");
  expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toEqual([]);
  await lane.browser("press", "Escape");
  await lane.until("!document.querySelector('[role=menu]')");
  await lane.browser("click", '[aria-label="Create"]');
  expect(await lane.evaluate("!!document.querySelector('[role=menu]')")).toBe(false);
  await fresh("tree-40");
  await lane.evaluate("window.__fake.failNext(-32003, 'Workstream could not be created. Retry with your saved input.'); true");
  await lane.browser("click", '[aria-label="Create"]');
  await lane.browser("click", '[role=menuitem][data-value=workstream]');
  await lane.until("!!document.querySelector('.rail-command-notice [role=alert]')");
  await lane.capture("U4313b", "tree-40-failure");
  await lane.browser("click", '.rail-command-notice button');
  await lane.until("!document.querySelector('.rail-command-notice [role=alert]')");
  await lane.capture("U4313b", "tree-40-retry");
}, 60_000);

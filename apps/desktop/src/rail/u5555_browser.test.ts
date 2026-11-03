import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, it, expect } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => {
  lane = await openLane(1512, "dark", "u5555");
  const recording = captureDir("U5629") ? join(captureDir("U5629")!, process.env.ROUNDUP_CAPTURE_PHASE ?? "head") : captureDir("U5555");

  if (recording) {
    mkdirSync(recording, { recursive: true });
    await lane.browser("record", "restart", join(recording, "creation.webm"));
  }
}, 60_000);

afterAll(async () => {
  try { if (captureDir("U5629") || captureDir("U5555")) await lane?.browser("record", "stop"); }
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
  await lane.evaluate("(() => { const scroll = document.querySelector('.rail-scroll'); scroll.scrollTop = scroll.scrollHeight; return true; })()");
  await lane.capture("U4313b", "tree-40-failure-bottom");
  await lane.browser("click", '.rail-command-notice button');
  await lane.until("!document.querySelector('.rail-command-notice [role=alert]')");
  await lane.capture("U4313b", "tree-40-retry");
}, 60_000);


it.each(["pointer", "Enter", "Space"])("u5629_rendered_failed_start_recovery_%s", async opening => {
  await fresh("tree-40");
  // Failed-start recovery begins at a Workstream without requesting descendants.
  await lane.evaluate("window.__fake.setStatus('migrate', 'idle', 'idle'); true");
  await lane.browser("click", '[data-id="backend"][data-part="branch-control"]');
  await lane.until("!!document.querySelector('[role=treeitem][data-id=backend][aria-selected=true]')");
  await lane.evaluate("(() => { const app = window.__fake.app; const spawn = app.handlers['agent.spawn']; app.handlers['agent.spawn'] = params => { app.handlers['agent.spawn'] = spawn; throw window.__fake.refusal(-32003, 'Spawn refused. Check setup and retry.'); }; return true; })()");
  await lane.browser("press", "Meta+n");
  await lane.until("!!document.querySelector('.rail-command-notice [role=alert]') && !document.querySelector('[aria-label=Create][aria-disabled=true]')");
  const original = await lane.calls("agent.spawn");
  expect(original).toHaveLength(1);
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";
  const dir = captureDir("U5629");

  const capture = async (step: string) => {
    if (!dir) return;
    const destination = join(dir, phase);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, `${opening}-${step}.checks.json`), JSON.stringify(await lane.evaluate("window.__checks()")) + "\n");
    await lane.browser("screenshot", join(destination, `${opening}-${step}.png`));
  };

  await capture("failure");

  if (opening === "pointer") await lane.browser("click", '[aria-label="Create"]');
  else {
    await lane.browser("focus", '[aria-label="Create"]');
    await lane.browser("press", opening);
  }

  await lane.until("document.activeElement?.getAttribute('role') === 'menu'");
  await capture("open");
  await lane.browser("press", "Escape");
  await lane.until("!document.querySelector('[role=menu]') && document.activeElement?.getAttribute('aria-label') === 'Create'");
  await capture("escape");
  expect(await lane.calls("agent.spawn")).toEqual(original);
  expect((await lane.calls()).filter(call => ['rail.createWorkstream', 'rail.startDoor'].includes(call.method))).toEqual([]);
  expect(await lane.evaluate("document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id')")).toBe("backend");

  // The paired main capture records the lost feedback before the repair.
  if (phase === "base") return;
  await lane.until("document.querySelector('.rail-command-notice [role=alert]')?.textContent.includes('Spawn refused. Check setup and retry.')");
  await lane.browser("click", '.rail-command-notice .reserved-actions button');
  await lane.until("window.__fake.app.calls.filter(call => call.method === 'agent.spawn').length === 2 && !document.querySelector('.rail-command-notice [role=alert]') && document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id') !== 'backend'");
  const retried = await lane.calls("agent.spawn");
  expect(retried).toHaveLength(2);
  expect(retried[1]).toEqual(original[0]);
  await capture("retry");
  await fresh("tree-40");
  await lane.evaluate("window.__fake.setStatus('migrate', 'idle', 'idle'); true");
  await lane.browser("click", '[data-id="backend"][data-part="branch-control"]');
  await lane.until("!!document.querySelector('[role=treeitem][data-id=backend][aria-selected=true]')");
  await lane.evaluate("(() => { const app = window.__fake.app; const spawn = app.handlers['agent.spawn']; app.handlers['agent.spawn'] = params => { app.handlers['agent.spawn'] = spawn; throw window.__fake.refusal(-32003, 'Spawn refused. Check setup and retry.'); }; return true; })()");
  await lane.browser("press", "Meta+n");
  await lane.until("!!document.querySelector('.rail-command-notice [role=alert]') && !document.querySelector('[aria-label=Create][aria-disabled=true]')");
  await lane.browser("click", '[aria-label="Create"]');
  await lane.until("document.activeElement?.getAttribute('role') === 'menu'");
  await lane.browser("press", "Escape");
  await lane.until("!document.querySelector('[role=menu]') && document.activeElement?.getAttribute('aria-label') === 'Create'");
  await lane.browser("click", '.rail-command-notice .reserved-actions button:last-child');
  await lane.until("!document.querySelector('.rail-command-notice [role=alert]')");
  expect(await lane.calls("agent.spawn")).toHaveLength(1);
  expect((await lane.calls()).filter(call => ['rail.createWorkstream', 'rail.startDoor'].includes(call.method))).toEqual([]);
  expect(await lane.evaluate("document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id')")).toBe("backend");
  await capture("dismiss");
}, 60_000);

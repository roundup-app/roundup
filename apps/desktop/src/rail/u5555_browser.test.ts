import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, it, expect } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => {
  lane = await openLane(1512, "dark", "u5555", false, null);
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

// CI5527b: each action and the wait that settles it share one CLI connection; a step stops the batch where it fails.
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

const wait = (predicate: string) => `wait --fn ${quote(predicate)}`;

const run = async (...commands: string[]) => {
  // A failed step exits non-zero; its reply on stdout names the step.
  const out = await lane.browser("--json", "batch", "--bail", ...commands).catch((error: { stdout?: string; message: string }) => { throw new Error(`${error.stdout ?? ""}\n${error.message.slice(0, 200)}`); });
  const replies: { success: boolean; error?: string }[] = JSON.parse(out);
  const failed = replies.find(reply => !reply.success);

  if (failed) throw new Error(failed.error);
};

const noticeReady = "!!document.querySelector('.rail-command-notice [role=alert]') && !document.querySelector('[aria-label=Create][aria-disabled=true]')";

const menuClosed = "!document.querySelector('[role=menu]') && document.activeElement?.getAttribute('aria-label') === 'Create'";

// The menu takes focus a frame after it mounts; a key pressed before then goes nowhere.
const menuFocused = "document.activeElement?.getAttribute('role') === 'menu'";

const kinds = ["agent", "workstream", "mode"];

const cases = ["empty-project", "tree-40"].flatMap(seed => kinds.map((kind, index) => ({ seed, kind, index, chord: ["Meta+n", "Alt+Meta+n", "Shift+Meta+m"][index]! })));

it.each(cases)("u5217_rendered_menu_matches_chord $seed $kind", async ({ seed, kind, chord }) => {
  const outcomes = [];
  const settled = kind === "mode" ? "!!document.querySelector('[role=dialog]')" : "window.__fake.app.calls.some(call => ['agent.spawn','rail.createWorkstream'].includes(call.method))";

  for (const menu of [false, true]) {
    await fresh(seed);

    if (menu) {
      await run(`click ${quote('[aria-label="Create"]')}`, wait("!!document.querySelector('[role=menu]')"));
      expect(await lane.evaluate("[...document.querySelectorAll('[role=menuitem]')].map(item => [item.dataset.value, item.getAttribute('aria-keyshortcuts'), item.querySelector('kbd').textContent])")).toEqual([
        ["agent", "Meta+N", "⌘N"], ["workstream", "Alt+Meta+N", "⌥⌘N"], ["mode", "Shift+Meta+M", "⇧⌘M"],
      ]);
      expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toEqual([]);

      if (kind === "agent") await lane.capture("U5217", `${seed}-menu`);
      await run(`click ${quote(`[role=menuitem][data-value=${kind}]`)}`, wait(settled), wait("!document.querySelector('[role=menu]')"));
    } else await run(`press ${chord}`, wait(settled), wait("!document.querySelector('[role=menu]')"));
    outcomes.push(await lane.evaluate("({ calls: window.__fake.app.calls.filter(call => ['agent.spawn','rail.createWorkstream'].includes(call.method)).map(call => ({method:call.method,params:call.params})), selection: document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id'), dialog: !!document.querySelector('[role=dialog]'), focus: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.getAttribute('data-id') })"));
  }

  expect(outcomes[1]).toEqual(outcomes[0]);
}, 60_000);

it.each(cases)("u5555_rendered_keyboard_chooses $seed $kind", async ({ seed, kind, index }) => {
  await fresh(seed);
  const highlighted = (value: string) => wait(`document.querySelector('[role=menuitem][data-highlighted]')?.dataset.value === '${value}'`);

  await run(`focus ${quote('[aria-label="Create"]')}`, "press Shift+Tab", "press Tab");
  expect(await lane.focused()).toBe("Create");
  await run(`press ${index % 2 ? "Space" : "Enter"}`, wait(menuFocused), "press Home", highlighted("agent"), "press ArrowDown", highlighted("workstream"), "press ArrowUp", highlighted("agent"));
  await lane.browser("press", "Escape");
  await lane.until(menuClosed);
  expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toEqual([]);
  await lane.capture("U4313b", `${seed}-rest`);
  await run("press Space", wait(menuFocused), "press Home", ...Array.from({ length: index }, () => "press ArrowDown"), highlighted(kind), "press Enter", wait(kind === "mode" ? "!!document.querySelector('[role=dialog]')" : "window.__fake.app.calls.some(call => ['agent.spawn','rail.createWorkstream'].includes(call.method))"));
  expect((await lane.calls()).filter(call => ["agent.spawn", "rail.createWorkstream"].includes(call.method))).toHaveLength(kind === "mode" ? 0 : 1);
}, 60_000);

it.each(["pointer", "Enter", "Space"])("u5629_rendered_failed_start_recovery_%s", async opening => {
  await fresh("tree-40");
  // Failed-start recovery begins at a Workstream without requesting descendants.
  await lane.evaluate("window.__fake.setStatus('migrate', 'idle', 'idle'); true");
  await run(`click ${quote('[data-id="backend"][data-part="branch-control"]')}`, wait("!!document.querySelector('[role=treeitem][data-id=backend][aria-selected=true]')"));
  await lane.evaluate("(() => { const app = window.__fake.app; const spawn = app.handlers['agent.spawn']; app.handlers['agent.spawn'] = params => { app.handlers['agent.spawn'] = spawn; throw window.__fake.refusal(-32003, 'Spawn refused. Check setup and retry.'); }; return true; })()");
  await run("press Meta+n", wait(noticeReady));
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

  await run(...(opening === "pointer" ? [`click ${quote('[aria-label="Create"]')}`] : [`focus ${quote('[aria-label="Create"]')}`, `press ${opening}`]), wait(menuFocused));
  await capture("open");
  await run("press Escape", wait(menuClosed));
  await capture("escape");
  expect(await lane.calls("agent.spawn")).toEqual(original);
  expect((await lane.calls()).filter(call => ['rail.createWorkstream', 'rail.startDoor'].includes(call.method))).toEqual([]);
  expect(await lane.evaluate("document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id')")).toBe("backend");

  // The paired main capture records the lost feedback before the repair.
  if (phase === "base") return;
  await lane.until("document.querySelector('.rail-command-notice [role=alert]')?.textContent.includes('Spawn refused. Check setup and retry.')");
  await run(`click ${quote(".rail-command-notice .reserved-actions button")}`, wait("window.__fake.app.calls.filter(call => call.method === 'agent.spawn').length === 2 && !document.querySelector('.rail-command-notice [role=alert]') && document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id') !== 'backend'"));
  const retried = await lane.calls("agent.spawn");
  expect(retried).toHaveLength(2);
  expect(retried[1]).toEqual(original[0]);
  await capture("retry");
  await fresh("tree-40");
  await lane.evaluate("window.__fake.setStatus('migrate', 'idle', 'idle'); true");
  await run(`click ${quote('[data-id="backend"][data-part="branch-control"]')}`, wait("!!document.querySelector('[role=treeitem][data-id=backend][aria-selected=true]')"));
  await lane.evaluate("(() => { const app = window.__fake.app; const spawn = app.handlers['agent.spawn']; app.handlers['agent.spawn'] = params => { app.handlers['agent.spawn'] = spawn; throw window.__fake.refusal(-32003, 'Spawn refused. Check setup and retry.'); }; return true; })()");
  await run("press Meta+n", wait(noticeReady), `click ${quote('[aria-label="Create"]')}`, wait(menuFocused), "press Escape", wait(menuClosed), `click ${quote(".rail-command-notice .reserved-actions button:last-child")}`, wait("!document.querySelector('.rail-command-notice [role=alert]')"));
  expect(await lane.calls("agent.spawn")).toHaveLength(1);
  expect((await lane.calls()).filter(call => ['rail.createWorkstream', 'rail.startDoor'].includes(call.method))).toEqual([]);
  expect(await lane.evaluate("document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id')")).toBe("backend");
  await capture("dismiss");
}, 60_000);

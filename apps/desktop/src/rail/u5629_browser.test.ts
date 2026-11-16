import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, it, expect } from "vitest";
import { captureDir } from "../testing/captures";
import { lane, fresh, run, quote, wait, menuClosed, menuFocused, openCreateLane, closeCreateLane } from "./u5555_support";

const artifacts = captureDir("U5629");

const recording = artifacts ? join(artifacts, process.env.ROUNDUP_CAPTURE_PHASE ?? "head") : null;

beforeAll(() => openCreateLane(recording), 60_000);

afterAll(() => closeCreateLane(recording), 60_000);

const noticeReady = "!!document.querySelector('.rail-command-notice [role=alert]') && !document.querySelector('[aria-label=Create][aria-disabled=true]')";

it.each(["pointer", "Enter", "Space"])("u5629_rendered_failed_start_recovery_%s", async opening => {
  await fresh("tree-40");
  // Failed-start recovery begins at a Workstream without requesting descendants.
  await lane.evaluate("window.__fake.setStatus('migrate', 'idle', 'idle'); true");
  await run(`click ${quote('[data-id="backend"]')}`, wait("!!document.querySelector('[role=treeitem][data-id=backend][aria-selected=true]')"));
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
  await run(`click ${quote('[data-id="backend"]')}`, wait("!!document.querySelector('[role=treeitem][data-id=backend][aria-selected=true]')"));
  await lane.evaluate("(() => { const app = window.__fake.app; const spawn = app.handlers['agent.spawn']; app.handlers['agent.spawn'] = params => { app.handlers['agent.spawn'] = spawn; throw window.__fake.refusal(-32003, 'Spawn refused. Check setup and retry.'); }; return true; })()");
  await run("press Meta+n", wait(noticeReady), `click ${quote('[aria-label="Create"]')}`, wait(menuFocused), "press Escape", wait(menuClosed), `click ${quote(".rail-command-notice .reserved-actions button:last-child")}`, wait("!document.querySelector('.rail-command-notice [role=alert]')"));
  expect(await lane.calls("agent.spawn")).toHaveLength(1);
  expect((await lane.calls()).filter(call => ['rail.createWorkstream', 'rail.startDoor'].includes(call.method))).toEqual([]);
  expect(await lane.evaluate("document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute('data-id')")).toBe("backend");
  await capture("dismiss");
}, 60_000);

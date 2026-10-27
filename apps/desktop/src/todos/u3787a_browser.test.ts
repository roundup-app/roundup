import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "./laneBrowser";

let lane: LaneBrowser;

beforeAll(async () => {
  lane = await openLane(1512, "dark", "u3787a");
  const dir = captureDir("U3787a");

  if (dir) { mkdirSync(dir, { recursive: true }); await lane.browser("record", "start", join(dir, "drawer-undo.webm")); }
}, 180_000);

afterAll(async () => {
  try { if (lane && captureDir("U3787a")) await lane.browser("record", "stop"); }
  finally { await lane?.close(); }
}, 180_000);

it("u3787a_success_and_partial_failure_offer_only_acknowledged_undo", async () => {
  for (const seed of ["tree-40", "tabs-8", "conflict", "dense-failure"]) {
    await lane.seedTodos(["same", "same", "Long é 🧭 ".repeat(12), "surviving dependent", "fifth"], true, seed === "dense-failure" ? "tree-40" : seed);
    // Recording replaces the page; reapply its media emulation after each seed navigation.
    await lane.browser("set", "media", "dark");
    await lane.until("matchMedia('(prefers-color-scheme: dark)').matches");
    const [id] = await lane.order();
    await lane.browser("focus", `.shelf [data-todo="${id}"] .todo-row-button`);
    await lane.browser("press", "Enter");
    await lane.until("!!document.querySelector('.todo-delete')");
    await lane.capture("U3787a", `${seed}-before`);

    if ((seed === "conflict" || seed === "dense-failure")) await lane.evaluate("(() => { window.__fake.failNext(-32003, 'The original Home changed. Restore the Home and retry deletion.'); return true; })()");
    await lane.browser("click", ".todo-delete");

    if ((seed === "conflict" || seed === "dense-failure")) {
      await lane.until("document.body.textContent.includes('The original Home changed')");
      await lane.capture("U3787a", `${seed}-failure`);
    } else {
      await lane.until("[...document.querySelectorAll('button')].some(b => b.textContent === 'Undo')");
      await lane.capture("U3787a", `${seed}-deleted`);
      await lane.evaluate("(() => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Undo').click(); return true; })()");
      await lane.until(`!!document.querySelector('.shelf [data-todo="${id}"]')`);
      expect(await lane.calls("todo.restore")).toHaveLength(1);
      await lane.capture("U3787a", `${seed}-restored`);
    }
  }
}, 180_000);

it("u3787a_shelf_pad_partial_failure_is_visible_and_one_undo_step", async () => {
  await lane.seedTodos(["same", "same", "long é 🧭".repeat(12), "dependent", "fifth"]);
  await lane.browser("set", "media", "dark");
  await lane.evaluate(`(async () => {
    const rpc = window.__fake.app.rpc;
    for (const pad of await rpc('pad.list', null)) await rpc('pad.delete', { name: pad.name });
    window.__fake.actAs({ kind: 'agent', id: 'tokens', parent: null });
    for (const name of ['first', 'second', '長い名前 é 🧭 '.repeat(6), 'fourth', 'fifth']) await rpc('pad.create', { name, text: 'original content' });
    window.__fake.actAs({ kind: 'user', id: 'you', parent: null });
    document.querySelector('#shelf-tab-pads').click();
    return true;
  })()`);
  await lane.until("document.querySelectorAll('.shelf .pad-name').length >= 5");
  await lane.resetCalls();
  await lane.browser("focus", ".shelf .pad-name");
  await lane.browser("press", "Meta+Enter");
  await lane.browser("press", "Shift+ArrowDown");
  await lane.until("[...document.querySelectorAll('.shelf button')].some(b => b.textContent === 'Delete 2')");
  await lane.capture("U3787a", "shelf-pads-before");
  await lane.evaluate("(() => { window.__fake.failNext(-32002, 'The original Home is unavailable. Restore the Home and retry deletion.'); [...document.querySelectorAll('.shelf button')].find(b => b.textContent === 'Delete 2').click(); return true; })()");
  await lane.until("document.body.textContent.includes('Could not delete') && [...document.querySelectorAll('button')].some(b => b.textContent === 'Undo')");
  await lane.capture("U3787a", "shelf-pads-partial-failure");
  expect(await lane.calls("pad.delete")).toHaveLength(2);
  await lane.evaluate("(() => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Undo').click(); return true; })()");
  await lane.until("document.querySelectorAll('.shelf .pad-name').length >= 5");
  expect(await lane.calls("pad.restore")).toHaveLength(1);
  await lane.capture("U3787a", "shelf-pads-restored");
}, 180_000);

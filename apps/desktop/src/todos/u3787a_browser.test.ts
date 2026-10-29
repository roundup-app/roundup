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
      await lane.until("document.body.textContent.includes('Deleted')");
      await lane.capture("U3787a", `${seed}-deleted`);
      await lane.evaluate("(() => { document.activeElement?.blur(); return true; })()");
      await lane.browser("press", "Meta+z");
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
  await lane.until("(() => { for (const group of document.querySelectorAll('.pads-tab [data-shelf-group][data-state=closed] [data-part=branch-control]')) group.click(); return document.querySelectorAll('.shelf .pad-name').length >= 5; })()");
  await lane.resetCalls();
  await lane.browser("focus", ".shelf .pad-name");
  await lane.browser("press", "Meta+Enter");
  await lane.browser("press", "Shift+ArrowDown");
  await lane.until("[...document.querySelectorAll('.shelf button')].some(b => b.textContent === 'Delete 2')");
  await lane.capture("U3787a", "shelf-pads-before");
  await lane.evaluate("(() => { window.__fake.failNext(-32002, 'The original Home is unavailable. Restore the Home and retry deletion.'); [...document.querySelectorAll('.shelf button')].find(b => b.textContent === 'Delete 2').click(); return true; })()");
  await lane.until("document.body.textContent.includes('Could not delete') && document.querySelectorAll('.shelf .pad-name').length === 4");
  await lane.capture("U3787a", "shelf-pads-partial-failure");
  // The fake transport refuses failNext before journaling; only the acknowledged member reaches its call journal.
  expect(await lane.calls("pad.delete")).toHaveLength(1);
  await lane.evaluate("(() => { document.activeElement?.blur(); return true; })()");
      await lane.browser("press", "Meta+z");
  await lane.until("(() => { for (const group of document.querySelectorAll('.pads-tab [data-shelf-group][data-state=closed] [data-part=branch-control]')) group.click(); return document.querySelectorAll('.shelf .pad-name').length >= 5; })()");
  expect(await lane.calls("pad.restore")).toHaveLength(1);
  await lane.capture("U3787a", "shelf-pads-restored");
}, 180_000);

it("u3787a_todo_drawer_explains_an_unconfirmed_pad_deletion", async () => {
  await lane.seedTodos(["same", "same", "Long é 🧭 ".repeat(12), "dependent", "fifth"]);
  await lane.browser("set", "media", "dark");
  const id = await lane.evaluate<number>("window.__fake.app.rpc('todo.list', null).then(rows => rows.find(row => row.title === 'same').id)");
  await lane.evaluate(`(() => {
    const app = window.__fake.app;
    const remove = app.handlers['pad.delete'];
    app.handlers['pad.delete'] = async params => { await remove(params); throw new Error('Deletion reply lost. Check deletion to recover.'); };
    app.handlers['pad.getDeletion'] = () => { throw new Error('Receipt lookup unavailable. Check deletion to recover.'); };
    document.querySelector('#shelf-tab-pads').click();
    return true;
  })()`);
  await lane.until("(() => { for (const group of document.querySelectorAll('.pads-tab [data-shelf-group][data-state=closed] [data-part=branch-control]')) group.click(); return !!document.querySelector('.shelf .pad-name'); })()");
  await lane.browser("focus", ".shelf .pad-name");
  await lane.browser("press", "d");
  await lane.until("[...document.querySelectorAll('button')].some(b => b.textContent === 'Check deletion')");
  await lane.until("!document.querySelector('[data-deletion-pending=true]')");
  await lane.browser("click", "#shelf-tab-todos");
  await lane.until(`(() => { for (const group of document.querySelectorAll('.todos-tab [data-shelf-group][data-state=closed] [data-part=branch-control]')) group.click(); return document.querySelector('.shelf [data-todo="${id}"] .todo-row-button')?.getBoundingClientRect().width > 0; })()`);
  await lane.browser("click", `.shelf [data-todo="${id}"] .todo-row-button`);
  await lane.browser("press", "Enter");
  await lane.until("!!document.querySelector('.todo-delete')");
  await lane.capture("U3787a", "pad-pending-before-refusal");
  await lane.browser("click", ".todo-delete");
  await lane.until("document.querySelector('.todo-delete-feedback')?.textContent.includes('An earlier deletion is unconfirmed. Check deletion first.')");
  expect(await lane.calls("todo.delete")).toHaveLength(0);
  expect(await lane.focused()).toBe("Delete Todo");
  await lane.capture("U3787a", "pad-pending-refused");
}, 180_000);

for (const [id, restoring] of [["U3787g", false], ["U3787h", true]] as const) {
  it(`${id.toLowerCase()}_refusal_and_recovery_on_the_dense_drawer`, async () => {
    const url = await lane.evaluate<string>("location.href");
    const dir = captureDir(id);

    if (dir) { mkdirSync(dir, { recursive: true }); await lane.browser("record", "start", join(dir, "refusal-recovery.webm")); }

    try {
      await lane.browser("open", url);
      await lane.browser("set", "media", "dark");
      await lane.until("!!document.querySelector('[data-todo-root]')");
      await lane.browser("click", "[data-todo-root]");
      await lane.evaluate("(() => { const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()");
      await lane.evaluate(`(async () => {
        const app = window.__fake.app;
        await app.rpc('todo.reopen', { id: 7 });
        const rows = await app.rpc('todo.list', null);
        for (const id of [5, 7]) {
          const row = rows.find(todo => todo.id === id);
          await app.rpc('todo.update', { id, title: '未完了 é 🧭 '.repeat(10) + id, body: row.body, expected_change: null });
        }
        window.__recoverDeletion = false;
        const remove = app.handlers['todo.delete'];
        const receipt = app.handlers['todo.deletion'];
        const restore = app.handlers['todo.restore'];
        if (!${restoring}) {
          app.handlers['todo.delete'] = async params => {
            const result = await remove(params);
            if (params.ids.includes(5)) throw new Error('Deletion reply lost. Check deletion to recover.');
            return result;
          };
          app.handlers['todo.deletion'] = params => {
            if (!window.__recoverDeletion) throw new Error('Receipt lookup unavailable. Check deletion to recover.');
            return receipt(params);
          };
        } else {
          app.handlers['todo.restore'] = async params => {
            window.__restoreWaiting = true;
            await new Promise(resolve => { window.__finishRestore = resolve; });
            return restore(params);
          };
        }
        return true;
      })()`);

      const open = async (todo: number) => {
        await lane.until(`(() => { document.querySelector('.shelf [data-shelf-group="unassigned"][data-state="closed"] [data-part="branch-control"]')?.click(); return !!document.querySelector('.shelf [data-todo="${todo}"] .todo-row-button'); })()`);
        await lane.browser("focus", `.shelf [data-todo="${todo}"] .todo-row-button`);
        await lane.browser("press", "Enter");
        await lane.until("!!document.querySelector('.todo-delete')");
      };

      await open(5);
      await lane.browser("click", ".todo-delete");
      await lane.until(restoring ? "!document.querySelector('.todo-delete')" : "[...document.querySelectorAll('button')].some(b => b.textContent === 'Check deletion')");

      if (!restoring) {
        await lane.browser("click", ".drawer .close");
        await lane.until("!document.querySelector('.drawer[data-open=true]')");
      }

      await open(7);
      await lane.browser("fill", ".todo-comment-field", "  未送信 é 🧭\n keep trailing spaces  ");

      if (restoring) {
        await lane.evaluate("(() => { document.activeElement?.blur(); return true; })()");
      await lane.browser("press", "Meta+z");
        await lane.until("window.__restoreWaiting === true");
      }

      await lane.capture(id, "before-refusal");
      await lane.browser("click", ".todo-delete");
      await lane.until(`document.querySelector('.todo-delete-feedback')?.textContent.includes('${restoring ? "Restoration is in progress" : "Deleting #5 is unconfirmed"}')`);
      await lane.capture(id, "refused");
      expect(await lane.focused()).toBe("Delete Todo");
      expect(await lane.evaluate<string>("document.querySelector('.todo-comment-field').value")).toBe("  未送信 é 🧭\n keep trailing spaces  ");

      if (restoring) await lane.evaluate("(() => { window.__finishRestore(); return true; })()");
      else {
        await lane.evaluate("window.__recoverDeletion = true");
        await lane.browser("focus", ".todo-delete-feedback .reserved-actions button");
        await lane.browser("press", "Enter");
      }

      await lane.until("!document.querySelector('.todo-delete-feedback')?.textContent.includes('before trying Delete') && !document.querySelector('.todo-delete-feedback')?.textContent.includes('Restoration is in progress')");
      expect(await lane.evaluate<number[]>("window.__fake.app.calls.filter(c => c.method === 'todo.delete').flatMap(c => c.params.ids)")).toEqual([5]);
      expect(await lane.evaluate<number[]>("window.__fake.app.rpc('todo.list', null).then(rows => rows.filter(t => [5,7].includes(t.id)).map(t => t.id).sort())")).toEqual(restoring ? [5, 7] : [7]);
      await lane.capture(id, "recovered");
      await lane.browser("click", ".todo-delete");
      await lane.until("!document.querySelector('.todo-delete')");
      expect(await lane.evaluate<number[]>("window.__fake.app.calls.filter(c => c.method === 'todo.delete').flatMap(c => c.params.ids)")).toEqual([5, 7]);
      await lane.capture(id, "new-delete");
    } finally { if (dir) await lane.browser("record", "stop"); }
  }, 180_000);
}

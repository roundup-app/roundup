import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLane } from "./laneBrowser";
import type { LaneBrowser } from "./laneBrowser";

/** Record rendered Checks for the independent critic; these tests assert actions and readback only. */
const read = async (lane: LaneBrowser, step: string): Promise<void> => {
  await lane.capture(step.startsWith("reorder") ? "U490a" : step === "baseline" || step === "dense-failure" ? "U492a" : "U491a", step);
};

describe.each([[1512, "dark"], [1512, "light"]] as const)("u492a at %i %s", (width, scheme) => {
  let lane: LaneBrowser;

  beforeAll(async () => { lane = await openLane(width, scheme, "u492a"); }, 180_000);

  afterAll(async () => { await lane?.close(); });

  it("u492a_rendered_checks", async () => {
    await lane.seedTodos(["first", "second", "third"]);

    await read(lane, "baseline");

    // Reorder by Move down, then a failed one, on a flat list: a nested row's order is its parent's (U3708).
    await lane.seedTodos(["first", "second", "third"], false);

    const initial = await lane.order();
    const [one] = initial;

    await lane.browser("focus", `.shelf [data-todo="${one}"] .todo-row-button`);
    await lane.browser("press", "Alt+ArrowDown");
    await lane.until(`document.querySelector('.shelf .todo-row[data-id]').dataset.id !== '${one}'`);
    await read(lane, "reorder");
    await lane.evaluate("(() => { window.__fake.failNext(-32001, 'cannot reorder'); return true; })()");
    // A click anywhere clears a row's failure, and the fake Daemon answers within the click, so the chord stands in for the control.
    await lane.browser("focus", `.shelf [data-todo="${one}"] .todo-row-button`);
    await lane.browser("press", "Alt+ArrowUp");
    await lane.until("document.querySelector('.shelf').textContent.includes('cannot reorder')");
    await read(lane, "reorder-failure");
    expect((await lane.calls("todo.reorder")).map(call => call.params)).toEqual([{ id: one, before: initial[2] }]);

    // U3787a replaces U491a's confirmation with immediate deletion and Undo.
    const [first, second] = await lane.order();

    // Cancelling the selection leaves every Todo untouched.
    await lane.browser("focus", `.shelf [data-todo="${first}"] .todo-row-button`);
    await lane.browser("press", "Meta+Enter");
    await lane.until(`document.querySelector('.shelf [data-todo="${first}"] .todo-row-button').getAttribute('aria-pressed') === 'true'`);
    await lane.browser("focus", `.shelf [data-todo="${second}"] .todo-row-button`);
    await lane.browser("press", "Meta+Enter");
    await lane.until(`document.querySelector('.shelf [data-todo="${second}"] .todo-row-button').getAttribute('aria-pressed') === 'true'`);
    await lane.browser("click", ".shelf-bulk-line button:nth-of-type(2)");
    await lane.until("!document.querySelector('.shelf-bulk')");
    expect(await lane.order()).toEqual([first, second, initial[2]]);
    expect(await lane.calls("todo.delete")).toEqual([]);

    await lane.browser("focus", `.shelf [data-todo="${first}"] .todo-row-button`);
    await lane.browser("press", "Meta+Enter");
    await lane.until(`document.querySelector('.shelf [data-todo="${first}"] .todo-row-button').getAttribute('aria-pressed') === 'true'`);
    await lane.browser("focus", `.shelf [data-todo="${second}"] .todo-row-button`);
    await lane.browser("press", "Meta+Enter");
    await lane.until(`document.querySelector('.shelf [data-todo="${second}"] .todo-row-button').getAttribute('aria-pressed') === 'true'`);
    await lane.browser("click", ".shelf-bulk-line button:nth-of-type(1)");
    await lane.until(`!document.querySelector('.shelf [data-todo="${first}"]') && !document.querySelector('.shelf [data-todo="${second}"]')`);
    expect(await lane.order()).toEqual([initial[2]]);
    // BulkDelete returns focus after acknowledged readback; Undo belongs to that Shelf.
    await lane.until("document.activeElement?.closest('[data-history-region]')?.dataset.historyRegion === 'shelf'");
    await lane.browser("press", "Meta+z");
    await lane.until(`!!document.querySelector('.shelf [data-todo="${first}"]') && !!document.querySelector('.shelf [data-todo="${second}"]')`);
    await read(lane, "undo");
    await lane.resetCalls();

    await lane.browser("focus", `.shelf [data-todo="${first}"] .todo-row-button`);
    await lane.browser("press", "Meta+Enter");
    await lane.until(`document.querySelector('.shelf [data-todo="${first}"] .todo-row-button').getAttribute('aria-pressed') === 'true'`);
    await lane.browser("focus", `.shelf [data-todo="${second}"] .todo-row-button`);
    await lane.browser("press", "Meta+Enter");
    await lane.until(`document.querySelector('.shelf [data-todo="${second}"] .todo-row-button').getAttribute('aria-pressed') === 'true'`);
    await lane.evaluate(`(() => {
      const app = window.__fake.app;
      const remove = app.handlers['todo.delete'];
      app.handlers['todo.delete'] = async params => {
        app.handlers['todo.delete'] = remove;
        const receipt = await remove({...params, ids: [${second}]});
        return {...receipt, missing: [${first}]};
      };
      return true;
    })()`);
    await lane.browser("click", ".shelf-bulk-line button:nth-of-type(1)");
    await lane.until("document.querySelector('.shelf-bulk')?.textContent.includes('no longer available')");
    await read(lane, "bulk-failure");
    expect(await lane.order()).toEqual([first, initial[2]]);
    expect((await lane.calls("todo.delete")).map(call => call.params)).toEqual([{ operation: expect.any(String), ids: [second, first] }]);

    // Tabs and the Home menu of an Agent's own Todo.
    await lane.browser("click", '.shelf-tabs [role="tab"][id="shelf-tab-pads"]');
    await lane.until("document.querySelector('.shelf-tabs [role=\"tab\"][aria-selected=\"true\"]')?.id === 'shelf-tab-pads'");
    await read(lane, "tabs");
    await lane.browser("click", '.shelf-tabs [role="tab"][id="shelf-tab-todos"]');

    const made = await lane.evaluate<number>(`(async () => {
      window.__fake.actAs({ kind: 'agent', id: 'agent-1', parent: null });
      const made = await window.__fake.app.rpc('todo.create', { title: 'agent todo', body: null, blockers: null });
      window.__fake.actAs({ kind: 'user', id: 'you', parent: null });
      return made.id;
    })()`);

    await lane.until(`!!document.querySelector('.shelf [data-todo="${made}"]')`);
    const owner = await lane.evaluate<string>(`document.querySelector('.shelf [data-todo="${made}"]').closest('[data-shelf-group]').dataset.shelfGroup`);

    if (await lane.evaluate<boolean>(`document.querySelector('[data-shelf-group="${owner}"]').getAttribute('aria-expanded') !== 'true'`)) {
      await lane.browser("click", `[data-shelf-group="${owner}"] .shelf-group-control`);
    }

    await lane.until(`document.querySelector('[data-shelf-group="${owner}"]').getAttribute('aria-expanded') === 'true'`);
    await lane.browser("scrollintoview", `.shelf [data-todo="${made}"] .todo-row-button`);
    const point = await lane.evaluate<{x: number; y: number}>(`(() => {const box=document.querySelector('.shelf [data-todo="${made}"] .todo-row-button').getBoundingClientRect();return {x:Math.round(box.left+box.width/2),y:Math.round(box.top+box.height/2)};})()`);

    await lane.browser("mouse", "move", String(point.x), String(point.y));
    await lane.browser("mouse", "down", "right");
    await lane.browser("mouse", "up", "right");
    await lane.until("window.__fake.app.menuLabels().length > 0");
    await read(lane, "home-menu");
    await lane.evaluate("window.__fake.app.closeMenu()");
  }, 240_000);

  it("u492a_dense_failure", async () => {
    // U154's densest data: a 120-character title and a Todo that waits on ten others.
    await lane.seedTodos(["x", "y", "z"]);
    // The Shelf lists the selected Agent's own Todos, so the Agent makes them.
    await lane.evaluate(`(async () => {
      const rpc = window.__fake.app.rpc;
      window.__fake.actAs({ kind: 'agent', id: 'tokens', parent: null });
      const ids = [];
      for (let at = 0; at < 10; at++) ids.push((await rpc('todo.create', { title: 'blocker ' + at, body: null, blockers: null })).id);
      const long = await rpc('todo.create', { title: 't'.repeat(120), body: null, blockers: null });
      const blocked = await rpc('todo.create', { title: 'blocked', body: null, blockers: null });
      await rpc('todo.setBlockers', { id: blocked.id, blockers: ids });
      window.__fake.actAs({ kind: 'user', id: 'you', parent: null });
      return long.id;
    })()`);
    await lane.until("document.querySelectorAll('.shelf .todo-row').length >= 13");

    const ids = (await lane.order()).toSorted((left, right) => left - right);

    // An injected move error shows on its row.
    await lane.evaluate("(() => { window.__fake.failNext(-32001, 'cannot move this Todo because the Daemon refused it'); return true; })()");
    await lane.browser("focus", `.shelf [data-todo="${ids[0]}"] .todo-row-button`);
    await lane.browser("press", "Alt+ArrowDown");
    await lane.until("document.querySelector('.shelf').textContent.includes('cannot move this Todo')");
    await read(lane, "dense-failure");
    expect(await lane.order()).toContain(ids[0]);
    expect(await lane.calls("todo.reorder")).toEqual([]);

    // An injected delete error shows in the bar.
    await lane.browser("focus", `.shelf [data-todo="${ids[1]}"] .todo-row-button`);
    await lane.browser("press", "Meta+Enter");
    await lane.browser("focus", `.shelf [data-todo="${ids[2]}"] .todo-row-button`);
    await lane.browser("press", "Meta+Enter");
    await lane.evaluate("(() => { window.__fake.failNext(-32001, 'cannot delete this Todo because the Daemon refused it'); return true; })()");
    await lane.browser("click", ".shelf-bulk-line button:nth-of-type(1)");
    await lane.until("document.querySelector('.shelf-bulk')?.textContent.includes('cannot delete this Todo')");
    await read(lane, "dense-failure");
    expect(await lane.order()).toContain(ids[1]);
    expect(await lane.order()).toContain(ids[2]);
    expect(await lane.calls("todo.delete")).toEqual([]);
  }, 240_000);
});

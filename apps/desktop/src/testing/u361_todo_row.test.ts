import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U361 needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

const FIXTURE = `async () => {
  const tab = [...document.querySelectorAll('.shelf-tabs [role=tab]')].find(t => t.textContent.startsWith('Todos'));
  if (tab.getAttribute("aria-expanded") !== "true") tab.click();
  window.__fake.actAs({kind: 'agent', id: 'agent-1', parent: null});
  const rpc = window.__fake.app.rpc;
  const create = (title, blockers = null) => rpc('todo.create', {title, body: null, blockers});
  await create('w'.repeat(300));
  const blockers = [];
  for (let n = 0; n < 10; n++) blockers.push((await create('blocker ' + n)).id);
  await create('blocked by ten', blockers);
  const blocker = await create('b'.repeat(40));
  await create('t'.repeat(40), [blocker.id]);
  const done = await create('finished');
  await rpc('todo.complete', {id: done.id});

  return done.id;
}`;

run("u361 the rendered Todo row", () => {
  const [width, height] = [1512, 950] as const;

  it("u361_a_failed_tick_box_call_unchecks_it_and_keeps_visible_keyboard_focus", async () => {
    await page.scheme("light");
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", width, height);
    await page.until(`() => Boolean(document.querySelector('.shelf-tabs [role=tab]')) && Boolean(window.__fake)`);
    await page.call(FIXTURE);
    await page.until(`() => Boolean(document.querySelector('.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]'))`);
    await page.call(`() => document.querySelector('.shelf [data-shelf-group="unassigned"][data-state="closed"] [data-part="branch-control"]')?.click()`);
    await page.until(`() => Boolean(document.querySelector('.shelf .todo-row-button'))`);
    // The real keyboard generates the native change event; visit the row controls until its tick box.
    await page.call(`() => document.querySelector('.shelf [data-todo="1"] .todo-row-button').focus()`);

    for (let at = 0; at < 8; at++) {
      await page.press("Tab", "Tab");

      if (await page.call<boolean>(`() => document.activeElement.matches('.todo-tick')`)) break;
    }

    expect(await page.call<string>(`() => document.activeElement.type`)).toBe("checkbox");
    await page.call(`() => window.__fake.failNext(-32003, 'cannot complete this Todo')`);
    await page.press(" ", "Space");
    await page.until(`() => document.querySelector('.shelf .error')?.textContent.includes('cannot complete') || document.querySelector('.shelf').textContent.includes('cannot complete this Todo')`);
    expect(await page.call<boolean>(`() => document.activeElement.checked`)).toBe(false);
  }, 30_000);
});

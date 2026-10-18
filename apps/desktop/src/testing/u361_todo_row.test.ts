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
  const tab = [...document.querySelectorAll('.shelf [role=tab]')].find(t => t.textContent.startsWith('Todos'));
  tab.click();
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

const READ = `() => [...document.querySelectorAll('.shelf .todo-row')].map(row => {
  const tick = row.querySelector('input[type=checkbox]');

  return {id: row.dataset.todo, checked: tick.checked, disabled: tick.disabled, words: row.textContent, home: Boolean(row.querySelector('[data-todo-home]'))};
})`;

type Row = { id: string; checked: boolean; disabled: boolean; words: string; home: boolean };

run("u361 the rendered Todo row", () => {
  const [width, height] = [1280, 800] as const;

  for (const seed of ["tree-40", "agents-10", "first-run"])
    for (const scheme of ["light", "dark"] as const) {
      it(`u361_the_rendered_done_row_is_ticked_and_disabled_with_no_id_or_move_words ${seed} ${scheme} ${width}x${height}`, async () => {
        await page.scheme(scheme);
        await page.load(`/harness.html?seed=${seed}`, width, height);
        await page.until(`() => Boolean(window.__fake) && document.body.textContent.length > 0`);

        if (seed !== "first-run") {
          await page.until(`() => Boolean(document.querySelector('.shelf [role=tab]'))`);
          await page.call(FIXTURE);
          await page.until(`() => [...document.querySelectorAll('.shelf button')].some(b => /done$/.test(b.textContent.trim()))`);
          await page.call(`() => [...document.querySelectorAll('.shelf button')].find(b => /done$/.test(b.textContent.trim())).click()`);
          await page.until(`() => Boolean(document.querySelector('.shelf input:disabled'))`);
          await page.hover(0, 0);
          const resting = await page.call<Row[]>(READ);
          expect(resting.length).toBeGreaterThan(12);
          expect(resting.some(row => row.checked && row.disabled)).toBe(true);

          for (const row of resting) {
            expect(row.checked).toBe(row.disabled);
            expect(row.words).not.toMatch(/#\d|\bcomplete\b|\bmove\b/);
            expect(row.home).toBe(false);
          }
        }

        if (seed === "first-run") expect(await page.call<boolean>(`() => document.querySelectorAll('.shelf [data-todo]').length === 0`)).toBe(true);
      }, 90_000);


      if (seed !== "first-run") it(`u361_a_failed_tick_box_call_unchecks_it_and_keeps_visible_keyboard_focus ${seed} ${scheme} ${width}x${height}`, async () => {
        await page.scheme(scheme);
        await page.load(`/harness.html?seed=${seed}`, width, height);
        await page.until(`() => Boolean(document.querySelector('.shelf [role=tab]')) && Boolean(window.__fake)`);
        await page.call(FIXTURE);
        await page.until(`() => Boolean(document.querySelector('.shelf .todo-row-button'))`);
        // The real keyboard generates the native change event; visit the row controls until its tick box.
        await page.call(`() => document.querySelector('.shelf [data-todo-waits]').closest('.shelf-row').querySelector('.todo-row-button').focus()`);

        for (let at = 0; at < 8; at++) {
          await page.press("Tab", "Tab");

          if (await page.call<boolean>(`() => document.activeElement.matches('.todo-tick')`)) break;
        }

        expect(await page.call<string>(`() => document.activeElement.type`)).toBe("checkbox");
        await page.call(`() => window.__fake.failNext(-32000, 'cannot complete this Todo')`);
        await page.press(" ", "Space");
        await page.until(`() => document.querySelector('.shelf .error')?.textContent.includes('cannot complete') || document.querySelector('.shelf').textContent.includes('cannot complete this Todo')`);
        expect(await page.call<boolean>(`() => document.activeElement.checked`)).toBe(false);
      }, 30_000);

    }
});

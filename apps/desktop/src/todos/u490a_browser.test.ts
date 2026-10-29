import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { captureDir } from "../testing/captures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U490a needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  if (page && captureDir("U3010c")) {
    const origin = await page.call<string>(`() => location.origin`);

    await promisify(execFile)("python3", ["observers/U3010c/unchanged-key.py"], {
      env: { ...process.env, ROUNDUP_HARNESS_URL: origin }, maxBuffer: 1024 * 1024,
    });
  }

  await page?.close();
}, 600_000);

type Point = { x: number; y: number };

type State = { ids: number[]; active: string | null; drawer: boolean; reorders: unknown[] };

type List = { name: string; rows: string; setup: () => Promise<void> };

/** The Shelf's unassigned group in Overview, expanded for ordering. */
const shelf: List = {
  name: "the Shelf's Todos",
  rows: '.shelf [data-shelf-group="unassigned"] .todo-list .todo-row-button',
  setup: async () => {
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", ...(captureDir("U490a") ? [1512, 950] as const : [1280, 820] as const));
    await page.until(`() => Boolean(document.querySelector('.shelf-tabs [role=tab]')) && Boolean(document.querySelector('[data-part="branch"][aria-expanded] > .rail-row')) && Boolean(window.__fake)`);
    await page.call(`() => {
      const tab = document.querySelector('#shelf-tab-todos');
      if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
      document.querySelector('[data-todo-root]').click();
    }`);
    await page.until(`() => Boolean(document.querySelector('.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]'))`);
    await page.call(`() => {
      document.querySelector('[data-todo-root]').click();
      document.querySelector('.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]')?.click();
    }`);
    await page.until(`() => document.querySelectorAll(".shelf .todo-list .todo-row-button").length > 2`);
  },
};

const centre = (rows: string, n: number, grip = true) => page.call<Point>(`(rows, n, grip) => {
  const el = document.querySelectorAll(rows)[n]; el.scrollIntoView({block: 'nearest'}); const b = (grip ? el.closest('.todo-row').querySelector('.sortable-handle') : el).getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, rows, n, grip);

const state = (rows: string) => page.call<State>(`rows => ({
  ids: [...document.querySelectorAll(rows)].map(b => Number(/#(\\d+)/.exec(b.getAttribute('aria-label'))[1])),
  active: document.activeElement?.getAttribute('aria-label') ?? null,
  drawer: document.querySelector('[aria-label=Drawer]')?.getAttribute('data-open') === 'true',
  reorders: window.__fake.app.calls.filter(c => c.method === 'todo.reorder').map(c => c.params),
})`, rows);

/** A pointer drag in small steps, as a hand makes one. */
/** `to` is measured once the drag has started: U3718 opens every owner's group then, which moves the rows. */
const drag = async (from: Point, to: () => Promise<Point>, release = true) => {
  await page.pointer("down", from.x, from.y);
  await page.pointer("move", from.x, from.y - 6);

  const target = await to();

  for (let step = 1; step <= 8; step++) await page.pointer("move", from.x + ((target.x - from.x) * step) / 8, from.y - 6 + ((target.y - from.y + 6) * step) / 8);

  if (release) await page.pointer("up", target.x, target.y);
};

const settled = async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.call(`() => Promise.all(
    [...document.querySelectorAll('.todo-row')].flatMap(row => row.getAnimations()).map(animation => animation.finished.catch(() => {}))
  ).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
};

const ALT = 1;

for (const list of [shelf]) {
  const { rows } = list;

  run(`u490a ${list.name} order on the shared Sortable`, () => {
    it.each(["fresh", "no event", "equal refetch"])("u490a_pointer_reorders after %s", async (preceding) => {
      await page.scheme(captureDir("U490a") ? "dark" : "light");
      await list.setup();

      if (preceding !== "fresh") {
        await page.call(`(rows, event) => {
          const app = window.__fake.app;
          const reorder = app.handlers['todo.reorder'];
          const read = app.handlers['todo.list'];
          window.__keyRead = false;
          app.handlers['todo.reorder'] = ({id}) => {
            const todo = read(null).find(todo => todo.id === id);
            if (event) window.__fake.emit({actor: {kind: 'user', id: 'you', parent: null}, name: 'todo.updated', data: todo});
            app.handlers['todo.reorder'] = reorder;
            return {...todo};
          };
          app.handlers['todo.list'] = (...args) => {
            const result = read(...args);
            // sortedList settles in a microtask; two frames observe the completed read and its DOM placement.
            requestAnimationFrame(() => requestAnimationFrame(() => { window.__keyRead = true; }));
            return result;
          };
          document.querySelectorAll(rows)[1].focus();
        }`, rows, preceding === "equal refetch");
        await page.press("ArrowUp", "ArrowUp", ALT);
        await page.until(`() => window.__keyRead`);
      }

      const before = await state(rows);
      const last = before.ids.length - 1;

      await drag(await centre(rows, last), () => centre(rows, 0));
      await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.reorder')`);
      await settled();

      const after = await state(rows);

      expect(after.reorders).toEqual([...before.reorders, { id: before.ids[last], before: before.ids[0] }]);
      expect(after.ids[0]).toBe(before.ids[last]);
      expect(after.drawer).toBe(false);
      expect(after.active).toContain(`#${before.ids[last]} `);
      const dir = captureDir("U490a");

      if (dir && preceding === "fresh") {
        mkdirSync(dir, { recursive: true });
        const name = "shelf";
        writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
        writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`)));
      }
    }, 60_000);

    it("u490a_cancel_and_noop_escape_cancels", async () => {
      await page.scheme(captureDir("U490a") ? "dark" : "light");
      await list.setup();

      const before = await state(rows);
      const first = await centre(rows, 0);
      const last = await centre(rows, before.ids.length - 1);

      await drag(last, async () => first, false);
      await page.press("Escape", "Escape");
      await page.pointer("up", first.x, first.y);
      await settled();
      expect(await state(rows)).toMatchObject({ ids: before.ids, drawer: false, reorders: [] });

      // Re-measure after cancellation: settling or owner groups can move rows.
      const origin = await centre(rows, before.ids.length - 1);

      // Past the activation distance and back to the row's own place: no move.
      await page.pointer("down", origin.x, origin.y);
      await page.pointer("move", origin.x, origin.y - 12);
      await page.pointer("move", origin.x, origin.y);
      await page.pointer("up", origin.x, origin.y);
      await settled();
      expect(await state(rows)).toMatchObject({ drawer: false, reorders: [] });
    }, 60_000);

    it("u490a_cancel_and_noop_original_gap_makes_no_call", async () => {
      await page.scheme(captureDir("U490a") ? "dark" : "light");
      await list.setup();

      const before = await state(rows);
      const last = await centre(rows, before.ids.length - 1);

      await page.pointer("down", last.x, last.y);
      await page.pointer("move", last.x + 6, last.y);
      // Sortable keeps the source row in place and draws its drop gap separately (ui/sortable.tsx).
      await page.until(`() => Boolean(document.querySelector('.sortable-slot:not([data-ending])'))`);
      const gap = await centre('.sortable-slot:not([data-ending])', 0, false);

      await page.pointer("move", gap.x, gap.y);
      await page.until(`() => document.querySelector('[data-sortable-index]')?.getAttribute('data-sortable-index') === "${before.ids.length - 1}"`);
      await page.pointer("up", gap.x, gap.y);
      await settled();
      expect(await state(rows)).toMatchObject({ ids: before.ids, drawer: false, reorders: [] });
    }, 60_000);

    it("u490a_keyboard_reorders", async () => {
      await page.scheme(captureDir("U490a") ? "dark" : "light");
      await list.setup();

      const before = await state(rows);

      await page.call(`rows => document.querySelectorAll(rows)[1].focus()`, rows);
      await page.press("ArrowUp", "ArrowUp", ALT);
      await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.reorder')`);
      await settled();

      const after = await state(rows);

      expect(after.reorders).toEqual([{ id: before.ids[1], before: before.ids[0] }]);
      expect(after.ids.slice(0, 2)).toEqual([before.ids[1], before.ids[0]]);
      expect(after.active).toContain(`#${before.ids[1]} `);

      await page.call(`rows => document.querySelectorAll(rows)[0].focus()`, rows);
      await page.press("ArrowUp", "ArrowUp", ALT);
      await settled();
      expect((await state(rows)).reorders).toHaveLength(1);
    }, 60_000);

  });
}

it("u4275b_tab_reaches_quick_actions", async () => {
  await shelf.setup();
  await page.call(`() => document.querySelector('.rail-row[data-id="tokens"]').focus()`);

  for (const name of ["Stop", "Open folder", "Open in editor"]) {
    await page.press("Tab", "Tab");
    await page.until(`() => document.activeElement?.getAttribute('aria-label') === ${JSON.stringify(name)}`);
  }

  await page.press("Tab", "Tab", 8);
  await page.until(`() => document.activeElement?.getAttribute('aria-label') === 'Open folder'`);
  await page.press("Enter", "Enter");
  await page.until(`() => window.__fake.app.openedTargets.length === 1`);
  await page.press(" ", "Space");
  await page.until(`() => window.__fake.app.openedTargets.length === 2`);
  expect(await page.call(`() => window.__fake.app.openedTargets[0]`)).toEqual(await page.call(`() => window.__fake.app.openedTargets[1]`));
}, 60_000);

it("u3789d_focus_reaches_open_and_secondary_actions", async () => {
  await shelf.setup();
  await page.call(`() => document.querySelector('.todos-tab [data-todo="1"] .todo-row-button').focus()`);
  await page.press("Tab", "Tab");
  await page.until(`() => document.activeElement?.matches('.todo-tick')`);
  await page.press("Tab", "Tab", 8);
  await page.until(`() => document.activeElement?.matches('.todos-tab [data-todo="1"] .todo-row-button')`);
  await page.press("Enter", "Enter");
  await page.until(`() => !!document.querySelector('.drawer[data-open=true]')`);
  expect(await page.call(`() => window.__fake.app.calls.filter(call => call.method === 'todo.getHistory').length`)).toBe(1);
  await page.press("Escape", "Escape");
  await page.until(`() => !document.querySelector('.drawer[data-open=true]')`);
}, 60_000);

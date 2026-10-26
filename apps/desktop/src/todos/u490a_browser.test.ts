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

afterAll(async () => { await page?.close(); });

type Point = { x: number; y: number };

type State = { ids: number[]; active: string | null; drawer: boolean; reorders: unknown[] };

type List = { name: string; rows: string; setup: () => Promise<void> };

/** The Rail of the `tree-40` harness with its first Agent's Todos shown. */
const nested: List = {
  name: "an Agent's Todos in the Rail",
  rows: "[data-pads] .todo-row-button",
  setup: async () => {
    await page.load("/harness.html?seed=tree-40", 1280, 820);
    await page.until(`() => Boolean(document.querySelector('.rail-pads-control')) && Boolean(window.__fake)`);
    await page.call(`() => document.querySelector('.rail-pads-control').click()`);
    await page.until(`() => document.querySelectorAll("[data-pads] .todo-row-button").length > 1`);
  },
};

/** The Shelf's unassigned group in Overview, expanded for ordering. */
const shelf: List = {
  name: "the Shelf's Todos",
  rows: '.shelf [data-shelf-group="unassigned"] .todo-list .todo-row-button',
  setup: async () => {
    await page.load("/harness.html?seed=tree-40", 1280, 820);
    await page.until(`() => Boolean(document.querySelector('.shelf-tabs [role=tab]')) && Boolean(document.querySelector('[data-part="branch"][aria-expanded] > .rail-row')) && Boolean(window.__fake)`);
    await page.call(`() => {
      const tab = document.querySelector('#shelf-tab-todos');
      if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
      document.querySelector('[data-todo-root]').click();
    }`);
    await page.call(`() => {
      document.querySelector('[data-todo-root]').click();
      document.querySelector('.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]')?.click();
    }`);
    await page.until(`() => document.querySelectorAll(".shelf .todo-list .todo-row-button").length > 2`);
  },
};

const centre = (rows: string, n: number) => page.call<Point>(`(rows, n) => {
  const el = document.querySelectorAll(rows)[n]; el.scrollIntoView({block: 'nearest'}); const b = el.getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, rows, n);

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

for (const list of [nested, shelf]) {
  const { rows } = list;

  run(`u490a ${list.name} order on the shared Sortable`, () => {
    it("u490a_pointer_reorders", async () => {
      await page.scheme("light");
      await list.setup();

      const before = await state(rows);
      const last = before.ids.length - 1;

      await drag(await centre(rows, last), () => centre(rows, 0));
      await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.reorder')`);
      await settled();

      const after = await state(rows);

      expect(after.reorders).toEqual([{ id: before.ids[last], before: before.ids[0] }]);
      expect(after.ids[0]).toBe(before.ids[last]);
      expect(after.drawer).toBe(false);
      expect(after.active).toContain(`#${before.ids[last]} `);
    }, 60_000);

    it("u490a_cancel_and_noop_escape_cancels", async () => {
      await page.scheme("light");
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
      await page.scheme("light");
      await list.setup();

      const before = await state(rows);
      const last = await centre(rows, before.ids.length - 1);

      await page.pointer("down", last.x, last.y);
      await page.pointer("move", last.x + 6, last.y);
      // Sortable keeps the source row in place and draws its drop gap separately (ui/sortable.tsx).
      await page.until(`() => Boolean(document.querySelector('.sortable-slot:not([data-ending])'))`);
      const gap = await centre('.sortable-slot:not([data-ending])', 0);

      await page.pointer("move", gap.x, gap.y);
      await page.until(`() => document.querySelector('[data-sortable-index]')?.getAttribute('data-sortable-index') === "${before.ids.length - 1}"`);
      await page.pointer("up", gap.x, gap.y);
      await settled();
      expect(await state(rows)).toMatchObject({ ids: before.ids, drawer: false, reorders: [] });
    }, 60_000);

    it("u3789a_a_click_selects_the_Todo_without_open_or_drag", async () => {
      await page.scheme("light");
      await list.setup();

      const beforeHover = await centre(rows, 0);
      await page.pointer("move", beforeHover.x, beforeHover.y);
      const point = await centre(rows, 0);

      await page.pointer("down", point.x, point.y);
      await page.pointer("up", point.x, point.y);
      await page.until(`() => document.activeElement?.matches(${JSON.stringify(rows)})`);
      expect(await state(rows)).toMatchObject({ drawer: false, reorders: [] });
    }, 60_000);

    it("u3789a_Return_on_a_row_button_opens_it_without_drag_semantics", async () => {
      await page.scheme("light");
      await list.setup();
      await page.call(`rows => document.querySelectorAll(rows)[0].focus()`, rows);
      // The shared Tooltip may describe the row; Sortable adds no drag role or disabled state.
      expect(await page.call<string[]>(`rows => [...document.querySelectorAll(rows)[0].attributes].map(a => a.name + "=" + a.value).filter(a => /^aria-(roledescription|grabbed|disabled)=/.test(a))`, rows)).toEqual([]);
      await page.press("Enter", "Enter");
      await page.until(`() => document.querySelector('[aria-label=Drawer]')?.getAttribute('data-open') === 'true'`);
      expect(await state(rows)).toMatchObject({ drawer: true, reorders: [] });
    }, 60_000);

    it("u490a_keyboard_reorders", async () => {
      await page.scheme("light");
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

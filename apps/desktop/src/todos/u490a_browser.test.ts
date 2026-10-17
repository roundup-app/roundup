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

const ROWS = "[data-pads] .todo-row-button";

/** The Rail of the `tree-40` harness with its first Agent's Todos shown. */
const setup = async () => {
  await page.load("/harness.html?seed=tree-40", 1280, 820);
  await page.until(`() => Boolean(document.querySelector('.rail-pads-control')) && Boolean(window.__fake)`);
  await page.call(`() => document.querySelector('.rail-pads-control').click()`);
  await page.until(`() => document.querySelectorAll(${JSON.stringify(ROWS)}).length > 1`);
};

const centre = (n: number) => page.call<Point>(`(rows, n) => {
  const b = document.querySelectorAll(rows)[n].getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, ROWS, n);

const state = () => page.call<State>(`rows => ({
  ids: [...document.querySelectorAll(rows)].map(b => Number(/#(\\d+)/.exec(b.getAttribute('aria-label'))[1])),
  active: document.activeElement?.getAttribute('aria-label') ?? null,
  drawer: document.querySelector('[aria-label=Drawer]')?.getAttribute('data-open') === 'true',
  reorders: window.__fake.app.calls.filter(c => c.method === 'todo.reorder').map(c => c.params),
})`, ROWS);

/** A pointer drag in small steps, as a hand makes one. */
const drag = async (from: Point, to: Point, release = true) => {
  await page.pointer("down", from.x, from.y);

  for (let step = 1; step <= 8; step++) await page.pointer("move", from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);

  if (release) await page.pointer("up", to.x, to.y);
};

const settled = () => new Promise((resolve) => setTimeout(resolve, 400));

run("u490a an Agent's Todos in the Rail order on the shared Sortable", () => {
  it("u490a_pointer_reorders", async () => {
    await page.scheme("light");
    await setup();

    const before = await state();
    const last = before.ids.length - 1;

    await drag(await centre(last), await centre(0));
    await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.reorder')`);
    await settled();

    const after = await state();

    expect(after.reorders).toEqual([{ id: before.ids[last], before: before.ids[0] }]);
    expect(after.drawer).toBe(false);
    expect(after.active).toContain(`#${before.ids[last]} `);
  }, 60_000);

  it("u490a_cancel_and_noop", async () => {
    await page.scheme("light");
    await setup();

    const first = await centre(0);
    const last = await centre((await state()).ids.length - 1);

    await drag(last, first, false);
    await page.press("Escape", "Escape");
    await page.pointer("up", first.x, first.y);
    await settled();
    // Past the activation distance and back to the row's own place: no move.
    await page.pointer("down", last.x, last.y);
    await page.pointer("move", last.x, last.y - 12);
    await page.pointer("move", last.x, last.y);
    await page.pointer("up", last.x, last.y);
    await settled();
    expect(await state()).toMatchObject({ drawer: false, reorders: [] });
  }, 60_000);

  it("u490a_a_click_opens_the_Todo_not_a_drag", async () => {
    await page.scheme("light");
    await setup();

    const point = await centre(0);

    await page.pointer("down", point.x, point.y);
    await page.pointer("up", point.x, point.y);
    await page.until(`() => document.querySelector('[aria-label=Drawer]')?.getAttribute('data-open') === 'true'`);
    expect(await state()).toMatchObject({ drawer: true, reorders: [] });
  }, 60_000);

  it("u490a_Enter_on_a_row_button_opens_it_without_drag_semantics", async () => {
    await page.scheme("light");
    await setup();
    await page.call(`rows => document.querySelectorAll(rows)[0].focus()`, ROWS);
    expect(await page.call<string[]>(`rows => [...document.querySelectorAll(rows)[0].attributes].map(a => a.name + "=" + a.value).filter(a => /^aria-(roledescription|describedby)=./.test(a))`, ROWS)).toEqual([]);
    await page.press("Enter", "Enter");
    await page.until(`() => document.querySelector('[aria-label=Drawer]')?.getAttribute('data-open') === 'true'`);
    expect(await state()).toMatchObject({ drawer: true, reorders: [] });
  }, 60_000);
});

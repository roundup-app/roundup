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

const SHELF = "[data-shelf-row] .todo-row-button";

/** The Shelf of the `tree-40` harness: the open Todos of its running Agent. */
const openShelf = async () => {
  await page.load("/harness.html?seed=tree-40", 1280, 820);
  await page.until(`() => document.querySelectorAll(${JSON.stringify(SHELF)}).length > 2 && Boolean(window.__fake)`);
};

const shelfCentre = (n: number) => page.call<Point>(`(rows, n) => {
  const b = document.querySelectorAll(rows)[n].getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, SHELF, n);

const shelfState = () => page.call<State & { moves: unknown[] }>(`rows => ({
  ids: [...document.querySelectorAll(rows)].map(b => Number(/#(\\d+)/.exec(b.getAttribute('aria-label'))[1])),
  active: document.activeElement?.getAttribute('aria-label') ?? null,
  drawer: document.querySelector('[aria-label=Drawer]')?.getAttribute('data-open') === 'true',
  reorders: window.__fake.app.calls.filter(c => c.method === 'todo.reorder').map(c => c.params),
  moves: window.__fake.app.calls.filter(c => c.method === 'todo.move').map(c => c.params),
})`, SHELF);

run("u490a the Shelf's Todos order on the shared Sortable", () => {
  it("u490a_pointer_reorders", async () => {
    await page.scheme("light");
    await openShelf();

    const before = await shelfState();
    const last = before.ids.length - 1;

    await drag(await shelfCentre(last), await shelfCentre(0));
    await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.reorder')`);
    await settled();

    const after = await shelfState();

    expect(after.reorders).toEqual([{ id: before.ids[last], before: before.ids[0] }]);
    expect(after.ids).toEqual([before.ids[last], ...before.ids.slice(0, last)]);
    expect(after.drawer).toBe(false);
    expect(after.active).toContain(`#${before.ids[last]} `);
  }, 60_000);

  it("u490a_cancel_and_noop", async () => {
    await page.scheme("light");
    await openShelf();

    const first = await shelfCentre(0);
    const last = await shelfCentre((await shelfState()).ids.length - 1);

    await drag(last, first, false);
    await page.press("Escape", "Escape");
    await page.pointer("up", first.x, first.y);
    await settled();
    await page.pointer("down", last.x, last.y);
    await page.pointer("move", last.x, last.y - 12);
    await page.pointer("move", last.x, last.y);
    await page.pointer("up", last.x, last.y);
    await settled();
    expect(await shelfState()).toMatchObject({ drawer: false, reorders: [], moves: [] });
  }, 60_000);

  it("u490a_a_drop_on_a_Workstream_moves_the_Todo_and_reorders_nothing", async () => {
    await page.scheme("light");
    await openShelf();

    const home = await page.call<Point>(`() => {
      const b = document.querySelector('.rail-row[data-id="backend"]').getBoundingClientRect();
      return {x: b.left + b.width / 2, y: b.top + b.height / 2};
    }`);

    await drag(await shelfCentre(0), home);
    await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.move')`);

    const state = await shelfState();

    expect(state.moves).toEqual([{ id: state.ids[0], home: "backend" }]);
    expect(state.reorders).toEqual([]);
  }, 60_000);
});

const centreOf = (selector: string) => page.call<Point>(`(selector) => {
  const b = document.querySelector(selector).getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, selector);

run("u362 the Shelf's rows drop on a Home", () => {
  it("u362_a_drop_on_the_project_root_sends_null_and_the_row_keeps_focus", async () => {
    await page.scheme("light");
    await openShelf();
    await drag(await shelfCentre(0), await centreOf('.rail-row[data-id="backend"]'));
    await page.until(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').length === 1`);
    await settled();
    await drag(await shelfCentre(0), await centreOf("[data-todo-root]"));
    await page.until(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').length === 2`);
    await settled();

    const state = await shelfState();

    expect(state.moves).toEqual([{ id: state.ids[0], home: "backend" }, { id: state.ids[0], home: null }]);
    expect(state.active).not.toBeNull();
  }, 60_000);

  it("u362_the_highlight_follows_the_pointer_and_a_drop_elsewhere_moves_nothing", async () => {
    await page.scheme("light");
    await openShelf();

    const from = await shelfCentre(0);
    const home = await centreOf('.rail-row[data-id="backend"]');

    await drag(from, home, false);
    expect(await page.call<string | null>(`() => document.querySelector('[data-drop]')?.getAttribute('data-id') ?? null`)).toBe("backend");
    await page.pointer("move", from.x, from.y + 4);
    expect(await page.call<boolean>(`() => document.querySelector('[data-drop]') === null`)).toBe(true);
    await page.pointer("up", from.x, from.y + 4);
    await settled();
    expect(await shelfState()).toMatchObject({ moves: [], reorders: [] });
  }, 60_000);

  it("u362_a_failed_move_shows_the_message", async () => {
    await page.scheme("light");
    await openShelf();
    await page.call(`() => { window.__fake.app.handlers['todo.move'] = () => { throw new Error('cannot move'); }; }`);
    await drag(await shelfCentre(0), await centreOf('.rail-row[data-id="backend"]'));
    await page.until(`() => document.body.textContent.includes('cannot move')`);
  }, 60_000);
});

/** Each row's top at every frame while `act` runs, by `#id`. */
const sample = async (act: () => Promise<void>, afterMs = 450) => {
  await page.call(`(rows) => {
    const idOf = b => Number(/#(\\d+)/.exec(b.getAttribute('aria-label'))[1]);
    window.__frames = [];
    window.__sampling = true;
    const read = () => {
      window.__frames.push({ at: performance.now(), tops: Object.fromEntries([...document.querySelectorAll(rows)].map(b => [idOf(b), b.closest('[data-shelf-row]').getBoundingClientRect().top])) });
      if (window.__sampling) requestAnimationFrame(read);
    };
    read();
  }`, SHELF);
  await act();
  await new Promise((resolve) => setTimeout(resolve, afterMs));

  return page.call<{ at: number; tops: Record<string, number> }[]>(`() => { window.__sampling = false; return window.__frames; }`);
};

const altDown = () => page.press("ArrowDown", "ArrowDown", 1);

const focusShelfRow = (n: number) => page.call(`(rows, n) => document.querySelectorAll(rows)[n].focus()`, SHELF, n);

run("u490a a moved Shelf row moves with the list's motion rules", () => {
  it("u490a_reorder_motion", async () => {
    await page.scheme("light");
    await openShelf();
    await focusShelfRow(0);

    const { ids } = await shelfState();
    const first = ids[0]!;
    const second = ids[1]!;
    const frames = await sample(altDown);

    const moved = frames.map((frame) => ({ at: frame.at, first: frame.tops[first]!, second: frame.tops[second]! }));
    const start = moved[0]!;
    const end = moved.at(-1)!;
    const going = moved.findIndex((frame) => Math.abs(frame.first - start.first) > 0.5);
    const arrived = moved.findIndex((frame, index) => index >= going && Math.abs(frame.first - end.first) < 1);

    expect(end.first).toBeGreaterThan(start.first);
    expect(end.second).toBeLessThan(start.second);
    // The row leaves its old place gradually and arrives within 150 ms, plus or minus 50, of its first move.
    expect(going).toBeGreaterThan(-1);
    expect(moved[going]!.first - start.first).toBeLessThan((end.first - start.first) / 2);
    expect(moved[arrived]!.at - moved[going]!.at).toBeGreaterThan(100);
    expect(moved[arrived]!.at - moved[going]!.at).toBeLessThan(200);
  }, 60_000);

  it("u490a_reorder_motion_in_one_frame_under_reduced_motion", async () => {
    await page.scheme("light", undefined, "motion");
    await openShelf();
    await focusShelfRow(0);

    const first = (await shelfState()).ids[0]!;
    const frames = (await sample(altDown)).map((frame) => frame.tops[first]!);
    const steps = frames.filter((top, index) => index > 0 && Math.abs(top - frames[index - 1]!) > 0.5);

    expect(steps).toHaveLength(1);
  }, 60_000);

  it("u490a_reorder_motion_interrupted_continues_from_the_row_on_screen", async () => {
    await page.scheme("light");
    await openShelf();
    await focusShelfRow(0);

    const first = (await shelfState()).ids[0]!;

    const sampled = await sample(async () => {
      await altDown();
      await new Promise((resolve) => setTimeout(resolve, 60));
      await altDown();
    }, 600);

    const frames = sampled.map((frame) => frame.tops[first]!);
    const pitch = Math.max(...frames) - Math.min(...frames);
    const jumps = frames.map((top, index) => (index === 0 ? 0 : Math.abs(top - frames[index - 1]!)));

    // No frame moves the row by more than a row's pitch: it never snaps back to its old place or on to its last.
    expect(Math.max(...jumps)).toBeLessThan(pitch * 0.75);
  }, 60_000);
});

run("u490a_tab_space_enter_reorders", () => {
  it("u490a_tab_space_enter_reorders", async () => {
    await page.scheme("light");
    await openShelf();
    await focusShelfRow(0);
    // From the first row's open button, Tab reaches its Move up, then its Move down; Space and Enter activate it.
    await page.press("Tab", "Tab");
    await page.press("Tab", "Tab");
    expect(await page.call<string>(`() => document.activeElement.getAttribute('aria-label')`)).toMatch(/^Move down$/);
    await page.press(" ", "Space");
    await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.reorder')`);
    await settled();

    const once = await shelfState();

    expect(once.reorders).toHaveLength(1);
    expect(once.reorders).toEqual([{ id: once.ids[1], before: once.ids[2] }]);
    expect(once.drawer).toBe(false);
    expect(once.active).toContain(`#${once.ids[1]} `);
  }, 60_000);
});

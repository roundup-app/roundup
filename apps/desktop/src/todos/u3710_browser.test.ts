import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U3710 needs Chromium");
  page = await openPage(found);
  await setup();
}, 90_000);

afterAll(async () => { await page?.close(); });

type Point = { x: number; y: number };

const rows = '.shelf [data-shelf-group="unassigned"] .todo-list .todo-row-button';

const setup = async () => {
  await page.scheme("dark");
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1512, 950);
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
  // The drop's calls must be the only ones: the seed's own are not counted.
  await page.call(`() => { window.__mark = window.__fake.app.calls.length; }`);
};

const ids = () => page.call<number[]>(`rows => [...document.querySelectorAll(rows)].map(b => Number(/#(\\d+)/.exec(b.getAttribute('aria-label'))[1]))`, rows);

const centre = (n: number) => page.call<Point>(`(rows, n) => {
  const b = document.querySelectorAll(rows)[n].closest(".todo-row").querySelector(".sortable-handle").getBoundingClientRect();
  return {x: b.left + 1, y: b.top + b.height / 2};
}`, rows, n);

type Call = { method: string; params: { id: number; before?: number; blockers?: number[] } };

const calls = () => page.call<Call[]>(`() => window.__fake.app.calls.slice(window.__mark).filter(c => c.method === 'todo.setBlockers' || c.method === 'todo.reorder')`);

const drag = async (from: Point, to: Point, release = true) => {
  await page.pointer("down", from.x, from.y);

  for (let step = 1; step <= 8; step++) await page.pointer("move", from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);

  if (release) await page.pointer("up", to.x, to.y);
};

const treeStep = () => page.call<number>(`() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tree-step'))`);

const settled = () => page.until(`() => !document.querySelector("[data-dnd-dragging], [data-dnd-placeholder]")`);

run("u3710 dragging sideways sets depth and dragging vertically sets order", () => {
  it("u3709_shift_tab_keeps_focus_when_siblings_change_tree_order", async () => {
    await setup();
    const order = await ids();

    await page.call(`async order => {
      await window.__fake.app.rpc('todo.setBlockers', {id: order[1], blockers: [order[0]]});
      await window.__fake.app.rpc('todo.setBlockers', {id: order[2], blockers: [order[0]]});
    }`, order);
    await page.until(`() => document.querySelectorAll('.shelf .todo-list [aria-level="2"]').length === 2`);
    await page.call(`rows => document.querySelectorAll(rows)[1].focus()`, rows);
    await page.press("Tab", "Tab", 8);
    await page.until(`() => document.querySelectorAll('.shelf .todo-list [aria-level="2"]').length === 1`);
    expect(await page.call<number>(`() => Number(document.activeElement.closest('[data-todo]')?.dataset.todo)`)).toBe(order[1]);
  });

  it.each(["pointer", "keyboard"])("u3800c_a_%s_nest_returns_focus_to_the_moved_grip", async (input) => {
    await setup();
    const order = await ids();
    const moved = order[1]!;

    if (input === "pointer") {
      const second = await centre(1);
      await drag(second, { x: second.x + 30, y: second.y });
    } else {
      await page.call(`id => document.querySelector('[data-todo="' + id + '"] .sortable-handle').focus()`, moved);
      await page.press(" ", "Space");
      await page.until(`() => Boolean(document.querySelector('[data-dnd-placeholder]'))`);
      await page.press("ArrowRight", "ArrowRight");
      await page.press(" ", "Space");
    }

    await page.until(`() => window.__fake.app.calls.slice(window.__mark).some(c => c.method === 'todo.setBlockers')`);
    await settled();
    expect(await page.call<number>(`() => document.activeElement.matches('.sortable-handle') ? Number(document.activeElement.closest('[data-todo]').dataset.todo) : null`)).toBe(moved);
  });

  it("u3710_a_sideways_drag_calls_set_blockers_and_a_vertical_one_calls_reorder", async () => {
    await setup();

    const order = await ids();
    const second = await centre(1);

    await drag(second, { x: second.x + 30, y: second.y });
    await page.until(`() => window.__fake.app.calls.slice(window.__mark).some(c => c.method === 'todo.setBlockers')`);
    await settled();
    expect((await calls()).map((c) => c.method)).toEqual(["todo.setBlockers"]);
    expect((await calls())[0]!.params).toMatchObject({ id: order[1] });
    expect((await calls())[0]!.params.blockers?.[0]).toBe(order[0]);

    await setup();
    const last = await centre(order.length - 1);
    const first = await centre(0);

    await drag(last, { x: last.x, y: first.y });
    await page.until(`() => window.__fake.app.calls.slice(window.__mark).some(c => c.method === 'todo.reorder')`);
    await settled();
    expect(await calls()).toEqual([{ method: "todo.reorder", params: { id: order[order.length - 1], before: order[0] } }]);
  }, 60_000);

  it("u3710_a_drag_that_changes_both_sets_blockers_then_reorders", async () => {
    await setup();

    const order = await ids();
    const last = await centre(order.length - 1);
    const second = await centre(1);

    await drag(last, { x: second.x + 30, y: second.y });
    await page.until(`() => window.__fake.app.calls.slice(window.__mark).some(c => c.method === 'todo.reorder')`);
    await settled();

    const made = await calls();

    expect(made.map((c) => c.method)).toEqual(["todo.setBlockers", "todo.reorder"]);
    expect(made[0]!.params.id).toBe(order[order.length - 1]);
    expect(made[1]!.params).toEqual({ id: order[order.length - 1], before: order[1] });
  }, 60_000);

  it("u3710_depth_is_bounded_by_the_row_above", async () => {
    await setup();

    const order = await ids();
    const first = await centre(0);
    // Empty owner targets can add a scrollbar during the drag; leave room for it inside the list.
    const right = await page.call<number>(`rows => document.querySelector(rows).closest('.todo-list').getBoundingClientRect().right - 1`, rows);

    // The first row has no row above: far right inside the list changes nothing.
    await drag(first, { x: Math.min(first.x + 200, right), y: first.y });
    await settled();
    expect(await calls()).toEqual([]);

    // The second row goes one level under the first, however far right the pointer is.
    const second = await centre(1);

    await drag(second, { x: Math.min(second.x + 300, right), y: second.y });
    await page.until(`() => window.__fake.app.calls.slice(window.__mark).some(c => c.method === 'todo.setBlockers')`);
    await settled();

    const made = await calls();

    expect(made).toHaveLength(1);
    expect(made[0]!.params.blockers?.[0]).toBe(order[0]);
  }, 60_000);

  it("u4710b_u3710_a_pointer_can_nest_two_levels_from_the_trailing_grip", async () => {
    await setup();
    const order = await ids();
    await page.call(`async order => {
      await window.__fake.app.rpc('todo.setBlockers', {id: order[1], blockers: [order[0]]});
      window.__mark = window.__fake.app.calls.length;
    }`, order);
    await page.until(`() => Boolean(document.querySelector('.shelf .todo-list [aria-level="2"]'))`);
    // The grip can sit at the inline edge; the library still identifies this list.
    await page.call(`rows => document.querySelector(rows).closest('.todo-list').style.paddingInlineEnd = '0px'`, rows);
    const edge = await centre(2);
    await drag(edge, { x: edge.x + 2 * await treeStep(), y: edge.y });
    await page.until(`() => window.__fake.app.calls.slice(window.__mark).some(c => c.method === 'todo.setBlockers')`);
    await settled();
    expect(await calls()).toEqual([{ method: "todo.setBlockers", params: { id: order[2], blockers: [order[1]] } }]);
  });

  it("u3711_a_refused_drop_shows_the_cause_and_changes_nothing", async () => {
    await setup();

    const order = await ids();
    const second = await centre(1);

    await page.call(`() => { window.__fake.failNext(-32003, 'todo would wait on itself'); return true; }`);
    await drag(second, { x: second.x + 30, y: second.y });
    await page.until(`() => document.querySelector('[role=alert]') !== null`);
    await settled();
    expect(await page.call<string>(`() => document.querySelector('[role=alert]').textContent`)).toBe("todo would wait on itself");
    // The refused call throws before the fake records it, so nothing else was called.
    expect(await calls()).toEqual([]);
    expect(await ids()).toEqual(order);
  }, 60_000);

  it("u3710_escape_and_a_release_outside_call_nothing", async () => {
    await setup();

    const second = await centre(1);

    await drag(second, { x: second.x + 60, y: second.y }, false);
    await page.press("Escape", "Escape");
    await page.pointer("up", second.x + 60, second.y);
    await settled();
    expect(await calls()).toEqual([]);

    await setup();
    const first = await centre(0);
    const last = await centre((await ids()).length - 1);

    // First project a different order inside the list, then release outside it.
    await drag(last, { x: last.x, y: first.y }, false);
    await page.pointer("move", 900, first.y);
    await page.pointer("up", 900, first.y);
    await settled();
    expect(await calls()).toEqual([]);
  }, 60_000);
});

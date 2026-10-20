import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U3710 needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

type Point = { x: number; y: number };

const rows = '.shelf [data-shelf-group="unassigned"] .todo-list .todo-row-button';

const setup = async () => {
  await page.scheme("light");
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
  // The drop's calls must be the only ones: the seed's own are not counted.
  await page.call(`() => { window.__mark = window.__fake.app.calls.length; }`);
};

const ids = () => page.call<number[]>(`rows => [...document.querySelectorAll(rows)].map(b => Number(/#(\\d+)/.exec(b.getAttribute('aria-label'))[1]))`, rows);

const centre = (n: number) => page.call<Point>(`(rows, n) => {
  const b = document.querySelectorAll(rows)[n].getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, rows, n);

type Call = { method: string; params: { id: number; before?: number; blockers?: number[] } };

const calls = () => page.call<Call[]>(`() => window.__fake.app.calls.slice(window.__mark).filter(c => c.method === 'todo.setBlockers' || c.method === 'todo.reorder')`);

const drag = async (from: Point, to: Point, release = true) => {
  await page.pointer("down", from.x, from.y);

  for (let step = 1; step <= 8; step++) await page.pointer("move", from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);

  if (release) await page.pointer("up", to.x, to.y);
};

const settled = () => new Promise((resolve) => setTimeout(resolve, 500));

run("u3710 dragging sideways sets depth and dragging vertically sets order", () => {
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

    // The first row has no row above: far right changes nothing.
    await drag(first, { x: first.x + 200, y: first.y });
    await settled();
    expect(await calls()).toEqual([]);

    // The second row goes one level under the first, however far right the pointer is.
    const second = await centre(1);

    await drag(second, { x: second.x + 300, y: second.y });
    await page.until(`() => window.__fake.app.calls.slice(window.__mark).some(c => c.method === 'todo.setBlockers')`);
    await settled();

    const made = await calls();

    expect(made).toHaveLength(1);
    expect(made[0]!.params.blockers?.[0]).toBe(order[0]);
  }, 60_000);

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
    await drag(await centre(1), { x: 5, y: 790 });
    await settled();
    expect(await calls()).toEqual([]);
  }, 60_000);
});

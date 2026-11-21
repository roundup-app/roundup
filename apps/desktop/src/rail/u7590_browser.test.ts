// oxlint-disable anti-slop/no-new-web-assertions
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const found = chromePath();

const run = found || process.env.CI ? it : it.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U7590 needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); }, 60_000);

type Box = { left: number; width: number };

type Marks = { slot: Box | null; ring: Box | null; glyph: Box; name: Box; chevron: Box; gap: number; icons: Box };

const load = async (seed: string) => {
  await page.scheme("dark");
  await page.load(`/harness.html?view=workstreams&items=1&tabs=1&seed=${seed}`, 1512, 950);
  await page.until(`() => Boolean(window.__fake) && document.querySelectorAll('.rail-row .row-age').length > 3`);
};

const slots = `() => [...document.querySelectorAll('.rail-tree .rail-row .action-slot[data-slot="todos"] .todo-ring')].map(s => s.getBoundingClientRect().left)`;

const marks = (index: number) => `() => {
  const box = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, width: b.width }; };
  const row = document.querySelectorAll('.rail-tree .rail-row')[${index}];
  const name = box(row.querySelector('.name'));
  const chevron = box(row.querySelector('.rail-chevron'));
  return {
    slot: box(row.querySelector('.action-slot[data-slot="todos"]')), ring: box(row.querySelector('.action-slot[data-slot="todos"] .todo-ring')),
    glyph: box(row.querySelector('.row-state')), name, chevron, gap: chevron ? name.left - (chevron.left + chevron.width) : Number.NaN,
    icons: box(row.querySelector('.row-icons')),
  };
}`;

const centre = (index: number) => `() => { const b = document.querySelectorAll('.rail-tree .rail-row')[${index}].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }`;

run("u7590a_the_ring_x_is_equal_across_counts", async () => {
  await load("tree-40");
  await page.call(`async () => {
    const ids = [...document.querySelectorAll('.rail-tree .rail-row')].slice(0, 12).map(r => r.getAttribute('data-id'));
    for (const owner of ids) {
      window.__fake.actAs({ kind: 'agent', id: owner, parent: null });
      await window.__fake.app.rpc('todo.create', { title: 'Ring ' + owner, body: '', blockers: null });
    }
    window.__fake.actAs({ kind: 'user', id: 'you', parent: null });
    return true;
  }`);
  await page.until(`() => document.querySelectorAll('.rail-tree .rail-row .action-slot[data-slot="todos"] .todo-ring').length > 1`);

  const lefts = await page.call<number[]>(slots);

  expect(lefts.length).toBeGreaterThan(1);

  for (const left of lefts) expect(Math.abs(left - (lefts[0] ?? Number.NaN))).toBeLessThanOrEqual(1);
}, 60_000);

run("u7590a_the_ring_does_not_move_on_hover_focus_or_selection", async () => {
  await load("agents-10");

  const rest = await page.call<Marks>(marks(1));
  const point = await page.call<{ x: number; y: number }>(centre(1));

  await page.hover(point.x, point.y);

  const hovered = await page.call<Marks>(marks(1));

  expect(Math.abs((hovered.slot?.left ?? 0) - (rest.slot?.left ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((hovered.ring?.left ?? 0) - (rest.ring?.left ?? 0))).toBeLessThanOrEqual(1);
}, 60_000);

run("u7590b_revealed_actions_move_no_mark", async () => {
  for (const seed of ["agents-10", "tree-40"]) {
    await load(seed);

    const rest = await page.call<Marks>(marks(1));
    const point = await page.call<{ x: number; y: number }>(centre(1));

    await page.hover(point.x, point.y);

    const hovered = await page.call<Marks>(marks(1));

    for (const key of ["glyph", "name", "icons"] as const) {
      expect(Math.abs(hovered[key].left - rest[key].left)).toBeLessThanOrEqual(1);
      expect(Math.abs(hovered[key].width - rest[key].width)).toBeLessThanOrEqual(1);
    }
  }
}, 60_000);

run("u7590c_the_chevron_keeps_a_gap_to_the_name", async () => {
  await load("tree-40");

  const space = await page.call<number>(`() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-1')) || 4`);
  const rest = await page.call<Marks>(marks(0));
  const point = await page.call<{ x: number; y: number }>(centre(0));

  await page.hover(point.x, point.y);

  const hovered = await page.call<Marks>(marks(0));

  expect(hovered.gap).toBeGreaterThanOrEqual(space);
  expect(Math.abs(hovered.name.left - rest.name.left)).toBeLessThanOrEqual(1);
}, 60_000);

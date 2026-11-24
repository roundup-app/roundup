// oxlint-disable anti-slop/no-new-web-assertions
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const found = chromePath();

const run = found || process.env.CI ? it : it.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U7205 needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); }, 60_000);

type Edges = { scroll: number; client: number; rail: number; ages: { depth: number; right: number }[]; frames: number[]; heights: number[] };

// The age's text, not its slot, must end on the one x: a long age that spills out of its slot moves that edge.
const read = `() => {
  const textRight = a => { const range = document.createRange(); range.selectNodeContents(a); return a.firstChild ? range.getBoundingClientRect().right : a.getBoundingClientRect().right; };
  const tree = document.querySelector('.rail-tree');
  const rows = [...tree.querySelectorAll('.rail-row')];
  return {
    scroll: tree.scrollWidth, client: tree.clientWidth, rail: tree.getBoundingClientRect().right,
    ages: rows.map(r => r.querySelector('.row-age')).map((a, i) => ({ depth: Number(rows[i].style.getPropertyValue('--tree-depth')), right: textRight(a) })),
    frames: [...tree.querySelectorAll('.rail-root-branch')].map(b => b.getBoundingClientRect().right),
    heights: rows.map(r => r.getBoundingClientRect().height),
  };
}`;

run("u7205f_depth_moves_no_edge", async () => {
  await page.scheme("dark");
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1512, 950);
  await page.until(`() => Boolean(window.__fake) && document.querySelectorAll('.rail-row .row-age').length > 3`);

  // The seed nests two deep; one Agent spawned under the deepest Agent makes depth 3, then every branch unfolds.
  await page.call<void>(`() => { window.__fake.app.handlers['agent.spawn']({ parent: 'tokens' }); }`);
  await page.until(`() => document.querySelectorAll('.rail-row .row-age').length > 3`);

  for (let i = 0; i < 6; i++) await page.call<void>(`() => { document.querySelectorAll('.rail-tree .rail-chevron[aria-expanded="false"]').forEach(b => b.click()); }`);

  const edges = await page.call<Edges>(read);
  const depths = new Set(edges.ages.map(a => a.depth));

  expect([...depths].sort()).toEqual([0, 1, 2, 3]);
  expect(edges.scroll).toBe(edges.client);

  const base = edges.ages.find(a => a.depth === 0)?.right ?? Number.NaN;

  for (const age of edges.ages) expect(Math.abs(age.right - base)).toBeLessThanOrEqual(1);

  for (const frame of edges.frames) expect(Math.abs(frame - edges.rail)).toBeLessThanOrEqual(1);
}, 60_000);

run("u7205c_age_right_edge_holds_in_hover_and_selection", async () => {
  await page.scheme("dark");
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1512, 950);
  await page.until(`() => Boolean(window.__fake) && document.querySelectorAll('.rail-row .row-age').length > 3`);

  const rest = await page.call<Edges>(read);

  const point = await page.call<{ x: number; y: number }>(`() => {
    const row = document.querySelector('.rail-tree .rail-row');
    const b = row.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }`);

  await page.hover(point.x, point.y);

  const hovered = await page.call<Edges>(read);
  const first = rest.ages[0]?.right ?? Number.NaN;

  for (const age of [...rest.ages, ...hovered.ages]) expect(Math.abs(age.right - first)).toBeLessThanOrEqual(1);
}, 60_000);

type Chips = { row: number; plain: number; box: { top: number; bottom: number; left: number; right: number }; chips: { top: number; bottom: number; left: number; right: number; shown: boolean }[]; changes: number; ageRight: number[] };

const readChips = `() => {
  const rows = [...document.querySelectorAll('.rail-tree .rail-row')];
  const row = rows.find(r => r.querySelector('.worktree-chips'));
  const plain = rows.find(r => !r.querySelector('.worktree-chips') && !r.hasAttribute('data-branch'));
  // The trailing group holds the Changes icon (its slot is empty in the seed), so the chips end left of it.
  const box = row.getBoundingClientRect();
  const textRight = a => { const range = document.createRange(); range.selectNodeContents(a); return range.getBoundingClientRect().right; };
  return {
    row: box.height, plain: plain.getBoundingClientRect().height,
    box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
    chips: [...row.querySelectorAll('.worktree-chip')].map(c => { const b = c.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, shown: b.width > 0 }; }),
    changes: row.querySelector('.row-tail').getBoundingClientRect().left,
    ageRight: rows.map(r => r.querySelector('.row-age')).filter(Boolean).map(textRight),
  };
}`;

const openWorktreeRow = async () => {
  await page.scheme("dark");
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1512, 950);
  await page.until(`() => Boolean(window.__fake) && document.querySelectorAll('.rail-row .row-age').length > 3`);

  for (let i = 0; i < 6; i++) await page.call<void>(`() => { document.querySelectorAll('.rail-tree .rail-chevron[aria-expanded="false"]').forEach(b => b.click()); }`);

  await page.until(`() => Boolean(document.querySelector('.rail-tree .worktree-chip'))`);
};

const focusWorktreeRow = () => page.call<void>(`() => { [...document.querySelectorAll('.rail-tree .rail-row')].find(r => r.querySelector('.worktree-chips')).focus(); }`);

run("u7205h_a_worktree_row_is_one_line_with_chips_left_of_the_changes_icon", async () => {
  await openWorktreeRow();
  await focusWorktreeRow();

  const read = await page.call<Chips>(readChips);

  expect(Math.abs(read.row - read.plain)).toBeLessThanOrEqual(1);
  expect(read.chips.filter(chip => chip.shown).length).toBeGreaterThanOrEqual(2);

  for (const chip of read.chips.filter(each => each.shown)) {
    expect(chip.top).toBeGreaterThanOrEqual(read.box.top - 1);
    expect(chip.bottom).toBeLessThanOrEqual(read.box.bottom + 1);
    expect(chip.right).toBeLessThanOrEqual(read.changes + 1);
  }

  const [first = 0] = read.ageRight;

  for (const right of read.ageRight) expect(Math.abs(right - first)).toBeLessThanOrEqual(1);
}, 60_000);

run("u7205h_the_chips_hide_below_the_narrow_width", async () => {
  await openWorktreeRow();
  await focusWorktreeRow();
  await page.call<void>(`() => { document.querySelector('.rail').style.width = '5rem'; }`);

  const read = await page.call<Chips>(readChips);

  for (const chip of read.chips) expect(chip.shown).toBe(false);
}, 60_000);

run("u7205h_a_resting_worktree_row_reserves_no_room_for_its_chips", async () => {
  await openWorktreeRow();

  const room = await page.call<number>(`() => {
    const row = [...document.querySelectorAll('.rail-tree .rail-row')].find(r => r.querySelector('.worktree-chips'));
    return row.querySelector('.worktree-chips').getBoundingClientRect().width;
  }`);

  expect(room).toBe(0);
}, 60_000);

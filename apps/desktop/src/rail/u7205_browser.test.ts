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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/**
 * U3010c's rendered observer: the Shelf's Unassigned Todos on `tree-40`, dark 1512×950. A pointer reorder (third row above first), two rapid
 * keyboard swaps and the same swap under reduced motion are sampled each frame; raw row tops go to `captureDir("U3010c")` for the design
 * critic (docs/motion.md). Quarter speed is `Animation.playbackRate`, so times stay animation milliseconds.
 */
const art = captureDir("U3010c");

const found = chromePath();

const rendered = art && found ? it : it.skip;

const rows = '.shelf [data-shelf-group="unassigned"] .todo-list .todo-row-button';

const ALT = 1;

type Frame = { t: number; tops: Record<string, number> };

let page: ChromePage;

beforeAll(async () => {
  if (art && found) page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

const setup = async (reduced: boolean) => {
  await page.scheme("dark", undefined, reduced ? "motion" : undefined);
  await page.load("/harness.html?seed=tree-40", 1512, 950);
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
};

const sample = (quarter: boolean) => page.call<void>(`(rows, quarter) => {
  window.__frames = [];
  window.__sampling = true;
  const animate = Element.prototype.animate;
  Element.prototype.animate = function(...args) {
    const animation = animate.apply(this, args);
    if (quarter && this.matches('.todo-row')) animation.playbackRate = 0.25;
    return animation;
  };
  const scale = quarter ? 0.25 : 1;
  const read = () => {
    window.__frames.push({t: performance.now() * scale, tops: Object.fromEntries([...document.querySelectorAll(rows)].map(b => [/#(\\d+)/.exec(b.getAttribute('aria-label'))[1], b.closest('.todo-row').getBoundingClientRect().top]))});
    if (window.__sampling) requestAnimationFrame(read);
  };
  read();
}`, rows, quarter);

const stop = async () => {
  await new Promise((resolve) => setTimeout(resolve, 900));
  await page.call(`() => Promise.all([...document.querySelectorAll('.todo-row')].flatMap(row => row.getAnimations()).map(a => a.finished.catch(() => {}))).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`);

  return page.call<Frame[]>(`() => { window.__sampling = false; return window.__frames; }`);
};

const reorders = () => page.call<unknown[]>(`() => window.__fake.app.calls.filter(c => c.method === 'todo.reorder').map(c => c.params)`);

const centre = (n: number) => page.call<{ x: number; y: number }>(`(rows, n) => {
  const el = document.querySelectorAll(rows)[n]; el.scrollIntoView({block: 'nearest'}); const b = el.getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, rows, n);

const ids = () => page.call<string[]>(`rows => [...document.querySelectorAll(rows)].map(b => /#(\\d+)/.exec(b.getAttribute('aria-label'))[1])`, rows);

const save = (name: string, data: { before: string[]; mark?: number; frames: Frame[] }) => {
  mkdirSync(join(art!, "head"), { recursive: true });
  writeFileSync(join(art!, "head", `${name}.json`), JSON.stringify(data));
};

/** The moved rows' slide: it starts at the old place, leaves it and ends within 1 px by 200 ms (ease-out is inside 1 px of its end before the full 150); rows that did not change place stay within 1 px. */
const checkSlide = (run: Frame[], moved: string[]) => {
  const first = run[0]!.tops;
  const final = run.at(-1)!.tops;

  for (const id of Object.keys(final).filter((other) => !moved.includes(other))) expect(Math.max(...run.map((frame) => Math.abs(frame.tops[id]! - first[id]!)))).toBeLessThanOrEqual(1);

  for (const id of moved) {
    const series = run.map((frame) => ({ t: frame.t, top: frame.tops[id]! }));
    const begin = series.find((point) => Math.abs(point.top - first[id]!) >= 1)!;
    const end = series.find((point) => point.t >= begin.t && Math.abs(point.top - final[id]!) < 1)!;

    expect(series.filter((point) => point.t >= begin.t && point.t <= end.t && Math.abs(point.top - first[id]!) >= 1 && Math.abs(point.top - final[id]!) >= 1).length).toBeGreaterThanOrEqual(2);
    expect(end.t - begin.t).toBeGreaterThan(60);
    expect(end.t - begin.t).toBeLessThanOrEqual(200);
  }
};

rendered("u3010c_pointer_reorder_slides_from_the_screen", async () => {
  await setup(false);

  const before = await ids();
  const from = await centre(before.length - 1);

  await sample(true);
  await page.pointer("down", from.x, from.y);
  await page.pointer("move", from.x, from.y - 6);

  const to = await centre(0);

  for (let step = 1; step <= 8; step++) await page.pointer("move", from.x + ((to.x - from.x) * step) / 8, from.y - 6 + ((to.y - from.y + 6) * step) / 8);
  await page.pointer("up", to.x, to.y);
  await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.reorder')`);

  const run = await stop();

  expect(await reorders()).toEqual([{ id: Number(before.at(-1)), before: Number(before[0]) }]);
  save("pointer-reorder", { before, frames: run });
}, 60_000);

rendered("u3010c_rapid_swaps_retarget_without_a_jump", async () => {
  await setup(false);

  const before = await ids();

  await page.call(`rows => document.querySelectorAll(rows)[0].focus()`, rows);
  await sample(true);
  await page.press("ArrowDown", "ArrowDown", ALT);
  await page.until(`() => { const f = window.__frames; return Object.keys(f[0].tops).some(k => Math.abs(f.at(-1).tops[k] - f[0].tops[k]) > 5); }`);

  const mark = await page.call<number>(`() => window.__frames.length`);

  await page.press("ArrowDown", "ArrowDown", ALT);

  const run = await stop();
  const id = before[0]!;
  const series = run.map((frame) => frame.tops[id]!);
  const steps = series.slice(1).map((top, at) => Math.abs(top - series[at]!));

  expect(Math.max(...steps.slice(mark - 1, mark + 4))).toBeLessThanOrEqual(Math.max(...steps.slice(0, mark - 1)) + 12);
  save("rapid-swaps", { before, mark, frames: run });
}, 60_000);

rendered("u3010c_keyboard_swap_slides_and_reduced_motion_settles_in_one_frame", async () => {
  await setup(false);

  const before = await ids();

  await page.call(`rows => document.querySelectorAll(rows)[0].focus()`, rows);
  await sample(true);
  await page.press("ArrowDown", "ArrowDown", ALT);

  const normal = await stop();

  checkSlide(normal, [before[0]!, before[1]!]);
  save("keyboard-swap", { before, frames: normal });

  await setup(true);
  await page.call(`rows => document.querySelectorAll(rows)[0].focus()`, rows);
  await sample(false);
  await page.press("ArrowDown", "ArrowDown", ALT);

  const reduced = await stop();
  const first = reduced[0]!.tops;
  const changed = reduced.filter((frame) => Object.keys(first).some((id) => Math.abs(frame.tops[id]! - first[id]!) > 1));

  expect(changed[0]!.tops).toEqual(reduced.at(-1)!.tops);
  save("keyboard-swap-reduced", { before, frames: reduced });
}, 90_000);

rendered("u3010c_reduced_motion_toggled_mid_slide_settles_by_the_next_frame", async () => {
  await setup(false);

  const before = await ids();

  await page.call(`rows => document.querySelectorAll(rows)[0].focus()`, rows);
  await sample(true);
  await page.press("ArrowDown", "ArrowDown", ALT);
  await page.until(`() => { const f = window.__frames; return Object.keys(f[0].tops).some(k => Math.abs(f.at(-1).tops[k] - f[0].tops[k]) > 5); }`);

  const mark = await page.call<number>(`() => window.__frames.length`);

  await page.scheme("dark", undefined, "motion");

  const run = await stop();
  const final = run.at(-1)!.tops;
  const settled = run.findIndex((frame, at) => at >= mark && Object.keys(final).every((id) => Math.abs(frame.tops[id]! - final[id]!) < 1));

  // Quarter speed would take ~600 ms of wall time to finish; settling within three frames of the toggle is the switch, not the slide.
  expect(settled).toBeGreaterThan(-1);
  expect(settled - mark).toBeLessThanOrEqual(3);
  save("reduced-toggled-mid-slide", { before, mark, frames: run });
}, 90_000);

rendered("u3010c_refused_move_leaves_the_rows_where_they_were", async () => {
  await setup(false);

  const before = await ids();

  await page.call(`rows => document.querySelectorAll(rows)[0].focus()`, rows);
  await page.call(`() => { window.__fake.failNext(-32003, 'todo would wait on itself'); return true; }`);
  await sample(true);
  await page.press("ArrowDown", "ArrowDown", ALT);
  await page.until(`() => document.querySelector('[role=alert]') !== null`);

  const run = await stop();
  const first = run[0]!.tops;

  expect(await page.call<string>(`() => document.querySelector('[role=alert]').textContent`)).toBe("todo would wait on itself");
  expect(await ids()).toEqual(before);
  expect(await reorders()).toEqual([]);
  // The failure text opens a line under its row, so rows below it move down; no row changes place or slides.
  const order = (frame: Frame) => Object.keys(frame.tops).sort((x, y) => frame.tops[x]! - frame.tops[y]!);

  for (const frame of run) expect(order(frame)).toEqual(before);
  save("refusal", { before, frames: run });
}, 60_000);

rendered("u3010c_completing_a_row_slides_the_rows_below_it_up", async () => {
  await setup(false);

  const before = await ids();

  await sample(true);
  await page.call(`rows => document.querySelectorAll(rows)[1].closest('.todo-row').querySelector('.todo-tick').click()`, rows);
  await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.complete')`);

  const run = await stop();
  const after = await ids();

  expect(after).toEqual(before.filter((id) => id !== before[1]));
  save("completion", { before, frames: run });
  checkSlide(run, after.filter((id) => Math.abs(run.at(-1)!.tops[id]! - run[0]!.tops[id]!) > 1));
}, 60_000);

rendered("u3010c_inserting_a_row_leaves_the_rows_above_it_in_place", async () => {
  await setup(false);

  const before = await ids();

  await sample(true);
  await page.call(`() => window.__fake.app.handlers['todo.create']({title: 'inserted while sampling', body: null, blockers: null, owner: null})`);
  await page.until(`() => document.querySelectorAll(${JSON.stringify(rows)}).length > ${before.length}`);

  const run = await stop();
  const after = await ids();

  expect(after.filter((id) => before.includes(id))).toEqual(before);
  save("insertion", { before, frames: run });
  // An appended row moves no row above it: each existing row stays within 1 px of where it began.

  for (const id of before) expect(Math.max(...run.map((frame) => Math.abs(frame.tops[id]! - run[0]!.tops[id]!)))).toBeLessThanOrEqual(1);
}, 60_000);

rendered("u3010c_pointer_move_to_another_owner_group_slides_the_rows_it_leaves", async () => {
  await setup(false);

  const before = await ids();
  const from = await centre(0);

  await sample(true);
  await page.pointer("down", from.x, from.y);
  await page.pointer("move", from.x, from.y - 6);
  await page.until(`() => !!document.querySelector('.shelf [data-shelf-group="me"] .shelf-group-head')`);

  const to = await page.call<{ x: number; y: number }>(`() => {
    const el = document.querySelector('.shelf [data-shelf-group="me"] .shelf-group-head'); el.scrollIntoView({block: 'nearest'}); const b = el.getBoundingClientRect();
    return {x: b.left + b.width / 2, y: b.top + b.height / 2};
  }`);

  for (let step = 1; step <= 8; step++) await page.pointer("move", from.x + ((to.x - from.x) * step) / 8, from.y - 6 + ((to.y - from.y + 6) * step) / 8);
  await page.pointer("up", to.x, to.y);
  await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.assign')`);

  const run = await stop();
  const assigns = await page.call<unknown[]>(`() => window.__fake.app.calls.filter(c => c.method === 'todo.assign').map(c => c.params)`);

  expect(assigns).toHaveLength(1);
  expect(await reorders()).toEqual([]);
  expect(await ids()).not.toContain(before[0]);
  save("owner-move", { before, frames: run });
}, 60_000);

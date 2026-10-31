import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage, type ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const found = chromePath();

  if (!found) throw new Error("U522 needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

const read = <T,>(expression: string) => page.call<T>(`() => (${expression})`);

const wait = (expression: string) => page.until(`() => (${expression})`);

const load = async () => {
  await page.scheme(captureDir("U522") ? "dark" : "light");
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", captureDir("U522") ? 1512 : 1280, captureDir("U522") ? 950 : 800);
  await wait(`document.querySelector('[data-id="tokens"]') && window.__fake`);
};

const moves = () => read<unknown[]>(`window.__fake.app.calls.filter(call => call.method === 'rail.move').map(call => call.params)`);

const box = (id: string) => read<{ x: number; y: number; top: number; bottom: number; left: number }>(`(() => { const row = document.querySelector('.rail-row[data-id="${id}"]'); const r = row.querySelector(".sortable-handle").getBoundingClientRect(); const bounds = row.getBoundingClientRect(); return { x: r.x + Math.min(8, r.width / 2), y: r.y + r.height / 2, top: bounds.top, bottom: bounds.bottom, left: bounds.left }; })()`);

const order = () => read<string[]>(`[...document.querySelectorAll('.rail-tree [data-id]:not([data-dnd-placeholder])')].map(el => el.dataset.id).filter((id, at, all) => all.indexOf(id) === at)`);

let pointer = { x: 0, y: 0 };

const mouse = (action: "move" | "down" | "up", x = pointer.x, y = pointer.y) => {
  pointer = { x: Math.round(x), y: Math.round(y) };

  return page.pointer(action, pointer.x, pointer.y);
};

/** Presses `id`'s row, then moves below `to`, offset `shift` pixels from the press. */
const dragBelow = async (id: string, to: string, shift = 0) => {
  const from = await box(id);
  const target = await box(to);

  await mouse("move", from.x, from.y);
  await mouse("down");
  await mouse("move", from.x + 6, from.y + 6);
  await wait(`document.querySelector('.rail-row[data-id="${id}"]').dataset.lifted === 'true' || document.querySelector('[data-dnd-placeholder]')`);
  await mouse("move", Math.max(1, from.x + 6 + shift), target.bottom + 2);
  await mouse("move", Math.max(1, from.x + shift), target.bottom + 2);
};

const settle = (calls: number) => wait(`window.__fake.app.calls.filter(call => call.method === 'rail.move').length >= ${calls} && !document.querySelector('[data-dnd-placeholder]')`);

it("u522_pointer_move_calls_rail_move", async () => {
  await load();
  await dragBelow("tokens", "logins");
  await mouse("up");
  await settle(1);
  expect(await moves()).toEqual([{ id: "tokens", parent: "auth", index: 1 }]);
}, 90_000);

it("u522_cancel_calls_nothing", async () => {
  await load();
  const before = await order();
  await dragBelow("tokens", "logins");
  await page.press("Escape", "Escape");
  await mouse("up");
  await wait(`!document.querySelector('[data-dnd-placeholder]')`);
  expect(await moves()).toEqual([]);
  expect(await order()).toEqual(before);

  await dragBelow("tokens", "logins");
  await mouse("move", 1270, 400);
  await mouse("up");
  await wait(`!document.querySelector('[data-dnd-placeholder]')`);
  expect(await moves()).toEqual([]);
}, 90_000);

it("u522_conflict_restores_the_row", async () => {
  await load();
  const before = await order();
  await dragBelow("tokens", "logins");
  await read<void>(`window.__fake.failNext(-32003, 'CONFLICT: cannot move under an agent')`);
  await mouse("up");
  await wait(`[...document.querySelectorAll('[role=alert]')].some(el => el.textContent.includes('CONFLICT: cannot move under an agent'))`);
  expect(await order()).toEqual(before);
  const dir = captureDir("U522");

  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "conflict.png"), Buffer.from(await page.shot(), "base64"));
    writeFileSync(join(dir, "conflict.checks.json"), JSON.stringify(await read("window.__checks()")));
  }
}, 90_000);

it("u522_edge_scroll_reaches_an_offscreen_row", async () => {
  await load();
  const from = await box("tokens");
  const edge = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('.rail-scroll').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 4 }; })()`);

  await mouse("move", from.x, from.y);
  await mouse("down");
  await mouse("move", from.x + 6, from.y + 6);
  await mouse("move", edge.x, edge.y);
  await wait(`document.querySelector('.rail-scroll').scrollTop > 100`);
  await page.press("Escape", "Escape");
  await mouse("up");
  expect(await moves()).toEqual([]);
}, 90_000);

it("u522_keyboard_move", async () => {
  await load();
  await read<void>(`document.querySelector('[data-part="item"][data-id="tokens"] .sortable-handle').focus()`);
  await page.press(" ", "Space");
  await wait(`document.querySelector('[data-dnd-placeholder]')`);
  await page.press("ArrowDown", "ArrowDown");
  await page.press("ArrowRight", "ArrowRight");
  await page.press(" ", "Space");
  await settle(1);
  expect(await moves()).toEqual([{ id: "tokens", parent: "auth", index: 1 }]);
  await wait(`document.activeElement?.closest('[data-id]')?.dataset.id === 'tokens'`);
}, 90_000);

it("u522_a_press_on_a_button_starts_no_drag", async () => {
  await load();
  await read<void>(`document.querySelector('.rail-row[data-id="backend"]').focus()`);
  const chevron = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('[data-id="backend"] .rail-chevron, .rail-chevron').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

  await mouse("move", chevron.x, chevron.y);
  await mouse("down");
  await mouse("move", chevron.x + 4, chevron.y + 80);
  expect(await read<boolean>(`document.querySelector('[data-dnd-placeholder]') === null`)).toBe(true);
  await mouse("up");
  expect(await moves()).toEqual([]);
}, 90_000);

it.each(["backend", "auth", "tokens"])("u3515c_rail_nesting_excludes_self_descendants_and_unchanged_placement_%s", async target => {
  await load();
  await page.resize(1512, 950);
  await page.scheme("dark");
  // backend contains auth, which contains tokens. None is a destination for backend.
  await dragBelow("backend", target, 40);
  await mouse("up");
  await wait("!document.querySelector('[data-dnd-placeholder]')");
  expect(await moves()).toEqual([]);
}, 30_000);

it("u3515c_rail_nesting_moves_beyond_descendants", async () => {
  await load();
  await page.resize(1512, 950);
  await page.scheme("dark");
  const destination = await read<number>(`[...document.querySelectorAll('.rail-row[data-id]')].findIndex(row => row.dataset.id === 'agent-31')`);

  expect(destination).toBeGreaterThan(0);
  await dragBelow("backend", "agent-31", -20);
  // A positive index can still be inside backend's descendants, where dropping is a no-op.
  await wait(`Number(document.querySelector('.rail-sortable').dataset.sortableIndex) >= ${destination}`);
  await mouse("up");
  await settle(1);
  expect(await moves()).toEqual([expect.objectContaining({ id: "backend", parent: null })]);
  expect((await order()).indexOf("backend")).toBeGreaterThan(0);
}, 30_000);

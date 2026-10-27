import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async () => {
  await browser("set", "viewport", captureDir("U522") ? "1512" : "1280", captureDir("U522") ? "950" : "800");
  await browser("set", "media", captureDir("U522") ? "dark" : "light");
  await browser("open", url("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40"));
  await wait(`document.querySelector('[data-id="tokens"]') && window.__fake`);
};

const moves = () => read<unknown[]>(`window.__fake.app.calls.filter(call => call.method === 'rail.move').map(call => call.params)`);

const box = (id: string) => read<{ x: number; y: number; top: number; bottom: number; left: number }>(`(() => { const row = document.querySelector('.rail-row[data-id="${id}"]'); const r = row.querySelector(".name").getBoundingClientRect(); const bounds = row.getBoundingClientRect(); return { x: r.x + Math.min(8, r.width / 2), y: r.y + r.height / 2, top: bounds.top, bottom: bounds.bottom, left: bounds.left }; })()`);

const order = () => read<string[]>(`[...document.querySelectorAll('.rail-tree [data-id]:not([data-dnd-placeholder])')].map(el => el.dataset.id).filter((id, at, all) => all.indexOf(id) === at)`);

const mouse = (action: string, x?: number, y?: number) => browser("mouse", action, ...(x === undefined ? [] : [String(Math.round(x)), String(Math.round(y!))]));

/** Presses `id`'s row, then moves the pointer to the gap `depth` indents right of the row's left edge, `below` the bottom of `to`. */
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
  await browser("press", "Escape");
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
  await read<void>(`window.__fake.failNext(-32000, 'CONFLICT: cannot move under an agent')`);
  await mouse("up");
  await wait(`[...document.querySelectorAll('[role=alert]')].some(el => el.textContent.includes('CONFLICT: cannot move under an agent'))`);
  expect(await order()).toEqual(before);
  const dir = captureDir("U522");

  if (dir) {
    mkdirSync(dir, { recursive: true });
    await browser("screenshot", join(dir, "conflict.png"));
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
  await browser("press", "Escape");
  await mouse("up");
  expect(await moves()).toEqual([]);
}, 90_000);

it("u522_keyboard_move", async () => {
  await load();
  await browser("focus", `[data-part="item"][data-id="tokens"]`);
  await browser("press", "Space");
  await wait(`document.querySelector('[data-dnd-placeholder]')`);
  await browser("press", "ArrowDown");
  await browser("press", "ArrowRight");
  await browser("press", "Space");
  await settle(1);
  expect(await moves()).toEqual([{ id: "tokens", parent: "auth", index: 1 }]);
  await wait(`document.activeElement?.dataset.id === 'tokens'`);
}, 90_000);

it("u522_enter_still_selects_the_focused_row", async () => {
  await load();
  await browser("focus", `[data-part="item"][data-id="tokens"]`);
  await browser("press", "Enter");
  await wait(`document.querySelector('[data-part="item"][data-id="tokens"]').getAttribute('aria-selected') === 'true'`);
  expect(await read<boolean>(`document.querySelector('[data-dnd-placeholder]') === null`)).toBe(true);
  expect(await moves()).toEqual([]);
}, 90_000);

it("u522_file_drop_coexists", async () => {
  await load();
  expect(await read<boolean>(`(() => {
    const row = document.querySelector('[data-part="item"][data-id="tokens"]');
    const transfer = new DataTransfer(); transfer.items.add(new File(['hello'], 'example.txt', { type: 'text/plain' }));
    row.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
    row.dispatchEvent(over);
    return over.defaultPrevented || document.querySelector('[data-dnd-placeholder]') === null;
  })()`)).toBe(true);
  expect(await read<number>(`document.querySelectorAll('[data-dnd-placeholder]').length`)).toBe(0);
  expect(await moves()).toEqual([]);
}, 90_000);

it("u522_a_press_on_a_button_starts_no_drag", async () => {
  await load();
  await browser("focus", '.rail-row[data-id="backend"]');
  const chevron = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('[data-id="backend"] .rail-chevron, .rail-chevron').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

  await mouse("move", chevron.x, chevron.y);
  await mouse("down");
  await mouse("move", chevron.x + 4, chevron.y + 80);
  expect(await read<boolean>(`document.querySelector('[data-dnd-placeholder]') === null`)).toBe(true);
  await mouse("up");
  expect(await moves()).toEqual([]);
}, 90_000);

it("u3515c_rail_nesting_excludes_self_descendants_and_unchanged_placement", async () => {
  await load();
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  // backend contains auth, which contains tokens. None is a destination for backend.
  for (const target of ["backend", "auth", "tokens"]) {
    await dragBelow("backend", target, 40);
    await mouse("up");
    await wait("!document.querySelector('[data-dnd-placeholder]')");
    expect(await moves()).toEqual([]);
  }

  const destination = await read<number>(`[...document.querySelectorAll('.rail-row[data-id]')].findIndex(row => row.dataset.id === 'agent-31')`);

  expect(destination).toBeGreaterThan(0);
  await dragBelow("backend", "agent-31", -20);
  // A positive index can still be inside backend's descendants, where dropping is a no-op.
  await wait(`Number(document.querySelector('.rail-sortable').dataset.sortableIndex) >= ${destination}`);
  await mouse("up");
  await settle(1);
  expect(await moves()).toEqual([expect.objectContaining({ id: "backend", parent: null })]);
  expect((await order()).indexOf("backend")).toBeGreaterThan(0);
}, 10_000);

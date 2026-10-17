import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async (scheme: "light" | "dark" = "light", width = 1280) => {
  await browser("set", "viewport", String(width), "800");
  await browser("set", "media", scheme);
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`document.querySelector('[data-id="tokens"]') && window.__fake`);
};

const moves = () => read<unknown[]>(`window.__fake.app.calls.filter(call => call.method === 'rail.move').map(call => call.params)`);

const box = (id: string) => read<{ x: number; y: number; top: number; bottom: number; left: number }>(`(() => { const r = document.querySelector('[data-part="item"][data-id="${id}"], [data-part="branch-control"][data-id="${id}"], [data-id="${id}"] > [data-part="branch-control"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, left: r.left }; })()`);

const order = () => read<string[]>(`[...document.querySelectorAll('.rail-tree [data-id]:not([data-dnd-placeholder])')].map(el => el.dataset.id).filter((id, at, all) => all.indexOf(id) === at)`);

const mouse = (action: string, x?: number, y?: number) => browser("mouse", action, ...(x === undefined ? [] : [String(Math.round(x)), String(Math.round(y!))]));

/** Presses `id`'s row, then moves the pointer to the gap `depth` indents right of the row's left edge, `below` the bottom of `to`. */
const dragBelow = async (id: string, to: string, shift = 0) => {
  const from = await box(id);
  const target = await box(to);

  await mouse("move", from.x, from.y);
  await mouse("down");
  await mouse("move", from.x + 6, from.y + 6);
  await wait(`document.querySelector('[data-id="${id}"]').dataset.lifted === 'true' || document.querySelector('[data-dnd-placeholder]')`);
  await mouse("move", from.x + 6 + shift, target.bottom + 2);
  await mouse("move", from.x + shift, target.bottom + 2);
};

const settle = (calls: number) => wait(`window.__fake.app.calls.filter(call => call.method === 'rail.move').length >= ${calls} && !document.querySelector('[data-dnd-placeholder]')`);

it("u522_pointer_move_calls_rail_move", async () => {
  await load();
  await dragBelow("tokens", "logins");
  expect(await read<boolean>(`document.querySelector('.drop-line') !== null`)).toBe(true);
  await mouse("up");
  await settle(1);
  expect(await moves()).toEqual([{ id: "tokens", parent: "auth", index: 1 }]);
  expect(await read<boolean>(`document.querySelector('.drop-line') === null`)).toBe(true);
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
  expect(await read<boolean>(`document.querySelector('.drop-line') === null`)).toBe(true);
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
  const chevron = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('[data-id="backend"] .rail-chevron, .rail-chevron').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

  await mouse("move", chevron.x, chevron.y);
  await mouse("down");
  await mouse("move", chevron.x + 4, chevron.y + 80);
  expect(await read<boolean>(`document.querySelector('[data-dnd-placeholder]') === null`)).toBe(true);
  await mouse("up");
  expect(await moves()).toEqual([]);
}, 90_000);

const capture = async (name: string) => {
  const dir = captureDir("U522");

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${name}.png`));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await read<unknown>(`window.__checks()`)) + "\n");
};

for (const width of [1280, 1440]) {
  for (const scheme of ["light", "dark"] as const) {
    it(`u522_rendered_checks ${width} ${scheme}`, async () => {
      await load(scheme, width);
      await dragBelow("tokens", "logins");
      const open = await read<Checks>(`window.__checks()`);
      await capture(`drag-${width}-${scheme}`);
      await read<void>(`window.__fake.failNext(-32000, 'CONFLICT: ${"cannot move a Workstream under an Agent and keep its children ".repeat(2)}')`);
      await mouse("up");
      await wait(`[...document.querySelectorAll('[role=alert]')].some(el => el.textContent.includes('CONFLICT'))`);
      const rejected = await read<Checks>(`window.__checks()`);
      await capture(`rejected-${width}-${scheme}`);

      for (const checks of [open, rejected]) for (const id of ["D2", "D5", "D6"] as const) expect(checks[id].status).not.toBe("fail");
    }, 90_000);
  }
}

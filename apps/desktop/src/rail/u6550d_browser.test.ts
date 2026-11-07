import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage, type ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const found = chromePath();

  if (!found) throw new Error("U6550d needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

const read = <T,>(expression: string) => page.call<T>(`() => (${expression})`);

const wait = (expression: string) => page.until(`() => (${expression})`);

let pointer = { x: 0, y: 0 };

const mouse = (action: "move" | "down" | "up", x = pointer.x, y = pointer.y) => {
  pointer = { x: Math.round(x), y: Math.round(y) };

  return page.pointer(action, pointer.x, pointer.y);
};

const handle = (id: string) => read<{ x: number; y: number }>(`(() => { const r = document.querySelector('.rail-row[data-id="${id}"] .sortable-handle').getBoundingClientRect(); return { x: r.x + Math.min(8, r.width / 2), y: r.y + r.height / 2 }; })()`);

type Slide = { id: string; translates: number; shift: number; layout: number };

it("u6550d_escape_after_a_pointer_lift_slides_each_row_once", async () => {
  await page.scheme("light");
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1280, 800);
  await wait(`document.querySelector('[data-id="backend"]') && window.__fake`);

  // backend is a Workstream holding auth and its tokens.
  const from = await handle("backend");

  await mouse("move", from.x, from.y);
  await mouse("down");
  await mouse("move", from.x + 6, from.y + 6);
  await wait(`document.querySelector('[data-dnd-placeholder]')`);
  await mouse("move", from.x + 6, from.y + 90);
  await wait(`!document.querySelector('.rail-row[data-id="auth"]')`);
  // The sortable and the lift motion have run; a frame later the lifted layout is still.
  await page.until(`() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))`);

  const lifted = await read<Record<string, number>>(`Object.fromEntries([...document.querySelectorAll('.rail-row[data-id]')].map(row => [row.dataset.id, row.getBoundingClientRect().top]))`);

  await page.press("Escape", "Escape");
  await wait(`document.querySelector('.rail-row[data-id="auth"]')`);

  const rows = await read<Slide[]>(`[...document.querySelectorAll('.rail-row[data-id]')].map(row => {
    const translates = row.getAnimations().filter(a => a.effect instanceof KeyframeEffect && a.effect.getKeyframes().some(frame => "translate" in frame));
    const shift = new DOMMatrix(getComputedStyle(row).transform).m42;
    return { id: row.dataset.id, translates: translates.length, shift, layout: row.getBoundingClientRect().top - shift };
  })`);

  const moved = rows.filter(row => row.id !== "backend" && row.layout < 800 && row.id in lifted && Math.abs(lifted[row.id]! - row.layout) >= 20);

  // U6550d: the Escape fold is one Motion layout projection (U6398a), never a second translate.
  // oxlint-disable-next-line anti-slop/no-new-web-assertions
  expect(moved.length).toBeGreaterThan(0);

  for (const row of moved) {
    const back = lifted[row.id]! - row.layout;

    // A row the sortable displaced slides by its own single translate (the projection on it is a sub-pixel remainder); every other moved row is projected, never both.
    if (row.translates > 0) {
      // oxlint-disable-next-line anti-slop/no-new-web-assertions
      expect(row.translates, row.id).toBe(1);
      // oxlint-disable-next-line anti-slop/no-new-web-assertions
      expect(Math.abs(row.shift), row.id).toBeLessThan(3);
      continue;
    }

    // The projection starts at the place the row was drawn and has run toward the new place: same side, never past the lift.
    // oxlint-disable-next-line anti-slop/no-new-web-assertions
    expect(Math.sign(row.shift), row.id).toBe(Math.sign(back));
    // oxlint-disable-next-line anti-slop/no-new-web-assertions
    expect(Math.abs(row.shift), row.id).toBeLessThanOrEqual(Math.abs(back) + 1.5);
  }

  expect(await read<unknown[]>(`window.__fake.app.calls.filter(call => call.method === 'rail.move')`)).toEqual([]);
}, 90_000);

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U490a needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

type Point = { x: number; y: number };

type State = { ids: number[]; active: string | null; drawer: boolean; reorders: unknown[] };

const ROWS = ".shelf [data-shelf-row] .todo-row-button";

/** The Shelf of the `tree-40` harness with every Todo shown: its first open rows are #2, #4 (blocked), #6 and #8. */
const setup = async () => {
  await page.load("/harness.html?seed=tree-40", 1280, 820);
  await page.until(`() => Boolean(document.querySelector('.shelf [role=tab]')) && Boolean(window.__fake)`);
  await page.call(`() => {
    [...document.querySelectorAll('.shelf [role=tab]')].find(t => t.textContent.startsWith('Todos')).click();
    document.querySelector('.rail-row[aria-expanded]').click();
  }`);
  await page.until(`() => Boolean(document.querySelector('.shelf button[aria-pressed]'))`);
  await page.call(`() => document.querySelector('.scope-control[aria-pressed="false"]').click()`);
  await page.until(`() => Boolean(document.querySelector(${JSON.stringify(ROWS)}))`);
};

const centre = (n: number) => page.call<Point>(`(rows, n) => {
  const b = document.querySelectorAll(rows)[n].getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, ROWS, n);

const state = () => page.call<State>(`rows => ({
  ids: [...document.querySelectorAll(rows)].slice(0, 4).map(b => Number(/#(\\d+)/.exec(b.getAttribute('aria-label'))[1])),
  active: document.activeElement?.getAttribute('aria-label') ?? null,
  drawer: document.querySelector('[aria-label=Drawer]')?.getAttribute('data-open') === 'true',
  reorders: window.__fake.app.calls.filter(c => c.method === 'todo.reorder').map(c => c.params),
})`, ROWS);

/** A pointer drag in small steps, as a hand makes one; the sensor and the Home targets read the moves between. */
const drag = async (from: Point, to: Point, release = true) => {
  await page.pointer("down", from.x, from.y);

  for (let step = 1; step <= 8; step++) await page.pointer("move", from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);

  if (release) await page.pointer("up", to.x, to.y);
};

const settled = () => new Promise((resolve) => setTimeout(resolve, 400));

run("u490a the Shelf orders its Todos on the shared Sortable", () => {
  it("u490a_pointer_reorders", async () => {
    await page.scheme("light");
    await setup();
    await drag(await centre(2), await centre(0));
    await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.reorder')`);
    await settled();
    expect(await state()).toEqual({ ids: [6, 2, 4, 8], active: "Idle #6 todo 6", drawer: false, reorders: [{ id: 6, before: 2 }] });
  }, 60_000);

  it("u490a_cancel_and_noop", async () => {
    await page.scheme("light");
    await setup();
    const first = await centre(0);
    const third = await centre(2);

    await drag(third, first, false);
    await page.press("Escape", "Escape");
    await page.pointer("up", first.x, first.y);
    await settled();
    await drag(third, { x: third.x, y: third.y + 10 });
    await settled();
    await drag(third, { x: 640, y: 300 });
    await settled();
    expect(await state()).toMatchObject({ ids: [2, 4, 6, 8], drawer: false, reorders: [] });
  }, 60_000);

  it("u490a_tab_space_enter_reorders", async () => {
    await page.scheme("light");
    await setup();
    await page.call(`rows => document.querySelectorAll(rows)[0].focus()`, ROWS);
    // The first row has no Move up; the next stop after its button is Move down.
    await page.press("Tab", "Tab");
    expect((await page.call<string>(`() => document.activeElement.getAttribute('aria-label')`))).toBe("Move todo 2 down");
    await page.press("Enter", "Enter");
    await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.reorder')`);
    await settled();
    expect(await state()).toEqual({ ids: [4, 2, 6, 8], active: "Idle #2 todo 2", drawer: false, reorders: [{ id: 2, before: 6 }] });

    await page.press("Tab", "Tab");
    expect((await page.call<string>(`() => document.activeElement.getAttribute('aria-label')`))).toBe("Move todo 2 up");
    await page.press(" ", "Space");
    await page.until(`() => window.__fake.app.calls.filter(c => c.method === 'todo.reorder').length === 2`);
    await settled();
    expect(await state()).toEqual({ ids: [2, 4, 6, 8], active: "Idle #2 todo 2", drawer: false, reorders: [{ id: 2, before: 6 }, { id: 2, before: 4 }] });
  }, 60_000);
});

type Sample = { at: number; tops: Record<string, number> };

/** Samples the top of Todos #2 and #4 in every frame while `⌥↓` moves #2 below #4, then answers the frames. */
const sampleMove = async (): Promise<Sample[]> => {
  await setup();
  await page.call(`rows => {
    document.querySelectorAll(rows)[0].focus();
    window.__frames = [];
    const read = () => Object.fromEntries([2, 4, 6].map(id => [id, document.querySelector('.shelf [data-id="' + id + '"]').getBoundingClientRect().top]));
    const start = performance.now();
    const tick = () => { window.__frames.push({at: performance.now() - start, tops: read()}); if (performance.now() - start < 900) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }`, ROWS);
  await settled();
  await page.press("ArrowDown", "ArrowDown", 1);
  await new Promise((resolve) => setTimeout(resolve, 800));

  return page.call<Sample[]>(`() => window.__frames`);
};

run("u490a the moved rows keep U156's motion", () => {
  it("u490a_reorder_motion", async () => {
    await page.scheme("light");
    const frames = await sampleMove();
    const before = frames[0]!.tops;
    const after = frames.at(-1)!.tops;

    expect(after["2"]).toBeGreaterThan(before["2"]!);
    expect(after["4"]).toBeLessThan(before["4"]!);
    expect(after["6"]).toBe(before["6"]);
    expect(frames.every((frame) => frame.tops["6"] === before["6"])).toBe(true);

    const between = frames.filter((frame) => frame.tops["2"]! > before["2"]! + 1 && frame.tops["2"]! < after["2"]! - 1);

    expect(between.length).toBeGreaterThan(0);

    const reached = frames.find((frame) => Math.abs(frame.tops["2"]! - after["2"]!) < 0.5 && frame.at > between[0]!.at)!;

    expect(reached.at - between[0]!.at).toBeLessThanOrEqual(200);
  }, 60_000);

  it("u490a_reorder_motion_is_one_frame_under_reduced_motion", async () => {
    await page.scheme("light", undefined, "motion");
    const frames = await sampleMove();
    const before = frames[0]!.tops;
    const after = frames.at(-1)!.tops;

    expect(after["2"]).toBeGreaterThan(before["2"]!);
    expect(frames.some((frame) => frame.tops["2"]! > before["2"]! + 1 && frame.tops["2"]! < after["2"]! - 1)).toBe(false);
  }, 60_000);
});

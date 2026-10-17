import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U389 in a real Chromium: a real pointer drag of the Rail's Edge sets its width and clamps it. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U389 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

// Widths persist per Project: a test that drags must not leave its width for the next.
afterEach(async () => {
  await page.call(`() => localStorage.clear()`);
});

afterAll(async () => {
  await page?.close();
});

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=tree-40", width, height);
  await page.until(`() => Boolean(document.querySelector(".rail-actions button"))`);
};

// Real pointer input: Ark's Splitter ignores synthetic events that carry no active pointer. The drag moves the edge by `to - from`.
const dragEdge = async (label: string, panel: string, from: number, to: number): Promise<number> => {
  const at = await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('[aria-label="${label}"]').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: 200 }; }`);

  await page.down(at.x, at.y);
  await page.pointer("move", at.x + (to - from) / 2, at.y);
  await page.pointer("move", at.x + (to - from), at.y);
  await page.release(at.x + (to - from), at.y);
  await page.call(`() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);

  return page.call<number>(`() => document.querySelector("${panel}").getBoundingClientRect().width`);
};

const railDrag = (from: number, to: number) => dragEdge("Resize Rail", ".rail", from, to);

run("u389 the Rail Edge drag", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u389_a_drag_sets_the_width_and_clamps", async () => {
    await load(1280, 800);
    expect(await railDrag(288, 360)).toBe(360);
    expect(await railDrag(360, 900)).toBe(480);
    expect(await railDrag(480, 10)).toBe(252);
  });
});

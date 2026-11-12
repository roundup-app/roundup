import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { railEffective } from "../resize/widths";

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
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", width, height);
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

// What the Rail's drag persisted for the Project, the width it kept and whether it collapsed.
const stored = () => page.call<{ rail: number; collapsed: boolean }>(`() => JSON.parse(localStorage.getItem("roundup:viewer")) `);

const railDrag = (from: number, to: number) => dragEdge("Resize Rail", ".rail", from, to);

run("u389 the Rail Edge drag", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u389_a_drag_sets_the_width_and_clamps", async () => {
    await load(1280, 800);
    const target = 360;
    const beyond = 900;

    await railDrag(288, target);
    expect((await stored()).rail).toBe(target);

    await railDrag(target, beyond);
    expect((await stored()).rail).toBe(railEffective(beyond));

    // U6228: a drag below the minimum collapses the Rail to its strip, so the lower clamp is the collapse.
    await railDrag(railEffective(beyond), 10);
    expect((await stored()).collapsed).toBe(true);
  });
});

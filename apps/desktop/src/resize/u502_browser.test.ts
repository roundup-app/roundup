import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U502 in a real Chromium: the shared Ark Splitter reads real geometry, so widths, keys and drags are observed in the rendered App. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

const SHIFT = 8;

const META = 4;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U502 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

// Widths persist per Project: a test must not leave its width for the next.
afterEach(async () => {
  await page.call(`() => localStorage.clear()`);
});

afterAll(async () => {
  await page?.close();
});

const EDGES = { rail: { label: "Resize Rail", panel: ".rail", min: 252, max: 480, reset: 288 }, shelf: { label: "Resize Bench", panel: ".shelf", min: 240, max: 560, reset: 320 } } as const;

type Edge = (typeof EDGES)[keyof typeof EDGES];

const load = async (width: number) => {
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", width, 800);
  await page.until(`() => Boolean(document.querySelector('.rail-actions button')) && Boolean(document.querySelector('[aria-label="Resize Bench"]'))`);
  // Count each committed write of the saved widths, the one place a commit leaves a trace.
  await page.call(`() => { window.__commits = 0; const set = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (String(key).startsWith('roundup:widths:')) window.__commits += 1; return set.call(this, key, value); }; }`);
};

const commits = () => page.call<number>(`() => window.__commits`);

const value = (edge: Edge) => page.call<number>(`() => Number(document.querySelector('[aria-label="${edge.label}"]').getAttribute("aria-valuenow"))`);

// Starts at the control just before the edge in Tab order, so one real Tab must land on the edge.
const tabTo = async (edge: Edge) => {
  await page.call(`() => {
    const tabbable = [...document.querySelectorAll('a[href], button, input, textarea, select, [tabindex]')].filter((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length > 0);
    const at = tabbable.indexOf(document.querySelector('[aria-label="${edge.label}"]'));
    if (at < 1) throw new Error("the edge is not in the Tab order");
    tabbable[at - 1].focus();
  }`);
  await page.press("Tab", "Tab");
  expect(await page.call<string | null>(`() => document.activeElement?.getAttribute("aria-label") ?? null`)).toBe(edge.label);
};

const settled = (edge: Edge, px: number) => page.until(`() => document.querySelector("${edge.panel}").getBoundingClientRect().width === ${px} && document.querySelector('[aria-label="${edge.label}"]').getAttribute("aria-valuenow") === "${px}"`);

const drag = async (edge: Edge, by: number, finish: "release" | "escape", kept?: () => Promise<void>) => {
  const at = await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('[aria-label="${edge.label}"]').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: 200 }; }`);

  await page.down(at.x, at.y);
  await page.pointer("move", at.x + by / 2, at.y);
  await page.pointer("move", at.x + by, at.y);

  await kept?.();

  if (finish === "escape") await page.press("Escape", "Escape");

  await page.release(at.x + by, at.y);
};

run("u502 resize edges use Ark Splitter", () => {
  vi.setConfig({ testTimeout: 60_000 });

  it("u502_rail_arrow_keys_resize", async () => {
    await load(1280);
    await tabTo(EDGES.rail);
    expect(await page.call<string>(`() => document.activeElement.getAttribute("role") + "/" + document.activeElement.getAttribute("aria-orientation")`)).toBe("separator/vertical");
    await page.press("ArrowRight", "ArrowRight");
    await settled(EDGES.rail, 304);
    expect(await commits()).toBe(1);
    await page.press("ArrowLeft", "ArrowLeft");
    await settled(EDGES.rail, 288);
    expect(await commits()).toBe(2);
    expect(await value(EDGES.rail)).toBe(288);
  });

  it("u502_rail_reset_limits_and_persistence", async () => {
    await load(1280);
    await tabTo(EDGES.rail);
    await page.press("ArrowRight", "ArrowRight", SHIFT);
    await settled(EDGES.rail, 352);
    await page.press("End", "End");
    await settled(EDGES.rail, 480);
    await page.press("Home", "Home");
    await settled(EDGES.rail, 252);
    await page.press("Enter", "Enter");
    await settled(EDGES.rail, 288);
    await page.press("End", "End");
    await settled(EDGES.rail, 480);

    const at = await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('[aria-label="Resize Rail"]').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: 200 }; }`);

    await page.doubleClick(at.x, at.y);
    await settled(EDGES.rail, 288);
    await page.press("ArrowRight", "ArrowRight");
    await settled(EDGES.rail, 304);
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1280, 800);
    await page.until(`() => Boolean(document.querySelector('[aria-label="Resize Rail"]'))`);
    await settled(EDGES.rail, 304);
  });

  it("u502_shelf_keys_and_visibility", async () => {
    await load(1280);
    await tabTo(EDGES.shelf);
    await page.press("ArrowLeft", "ArrowLeft");
    await settled(EDGES.shelf, 336);
    await page.press("ArrowRight", "ArrowRight");
    await settled(EDGES.shelf, 320);
    await page.press("Home", "Home");
    await settled(EDGES.shelf, 240);
    await page.press("End", "End");
    await settled(EDGES.shelf, 560);
    await page.press("Enter", "Enter");
    await settled(EDGES.shelf, 320);
    await page.press("k", "KeyK", META);
    await page.press("b", "KeyB");
    await page.until(`() => !document.querySelector('[aria-label="Resize Bench"]') || document.querySelector('[aria-label="Resize Bench"]').closest("[hidden]") !== null`);
    expect(await page.call<boolean>(`() => { const edge = document.querySelector('[aria-label="Resize Bench"]'); return !edge || edge.tabIndex < 0 || edge.closest("[hidden]") !== null; }`)).toBe(true);
  });

  it("u502_drag_commit_and_cancel", async () => {
    await load(1280);
    await drag(EDGES.rail, 72, "release");
    await settled(EDGES.rail, 360);
    expect(await commits()).toBe(1);
    await drag(EDGES.rail, 900, "release");
    await settled(EDGES.rail, 480);
    await drag(EDGES.rail, -900, "release");
    await settled(EDGES.rail, 252);

    const committed = await commits();

    await drag(EDGES.rail, 100, "escape");
    await settled(EDGES.rail, 252);
    expect(await commits()).toBe(committed);
    await drag(EDGES.shelf, -100, "release");
    await settled(EDGES.shelf, 420);
    await drag(EDGES.shelf, -900, "release");
    await settled(EDGES.shelf, 560);
    await drag(EDGES.shelf, 900, "release");
    await settled(EDGES.shelf, 240);
  });

  it("u502_resize_preserves_terminal_fit", async () => {
    await load(1280);
    await page.call(`() => document.querySelector('.rail [data-id="agent-4"] .name').click()`);
    await page.until(`() => document.querySelector(".xterm-screen")`);

    const frames = () => page.call(`() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);
    const resizes = () => page.call<number>(`() => window.__fake.app.calls.filter((call) => call.method === "terminal.resize").length`);

    // Each drag refits the Terminal once, after the release, never while the button is pressed.
    for (const [edge, by, width] of [[EDGES.rail, 72, 360], [EDGES.shelf, -100, 420]] as const) {
      await frames();

      const before = await resizes();

      await drag(edge, by, "release", async () => {
        await frames();
        expect(await resizes() - before).toBe(0);
      });
      await settled(edge, width);
      await frames();
      expect(await resizes() - before).toBe(1);
    }
  });
});

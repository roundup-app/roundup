import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U520: the Rail's keyboard walk is the real Ark TreeView's in headless Chromium; `tree-40` is Workstream → Workstream → Agent with a sibling after the first. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const focused = (): Promise<string | null> =>
  page.call<string | null>(`() => document.activeElement?.closest('[data-id]')?.getAttribute('data-id') ?? null`);

const expanded = (id: string): Promise<string | null> =>
  page.call<string | null>(`(id) => document.querySelector('[role=treeitem][data-id="' + id + '"]')?.getAttribute('aria-expanded') ?? null`, id);

const at = async (id: string): Promise<void> => {
  await page.until(`() => document.activeElement?.closest('[data-id]')?.getAttribute('data-id') === ${JSON.stringify(id)}`);
  expect(await focused()).toBe(id);
};

const folded = async (id: string, value: "true" | "false"): Promise<void> => {
  await page.until(`() => document.querySelector('[role=treeitem][data-id="${id}"]')?.getAttribute('aria-expanded') === '${value}'`);
  expect(await expanded(id)).toBe(value);
};

const CODES = { ArrowDown: "ArrowDown", ArrowUp: "ArrowUp", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Home: "Home", End: "End", m: "KeyM" } as const;

const press = (key: keyof typeof CODES): Promise<void> => page.press(key, CODES[key]);

run("u520 the Rail is a tree", () => {
  beforeAll(async () => {
    if (!found) throw new Error("U520 needs a Chrome binary: set CHROME_PATH");

    page = await openPage(found);
  }, 90_000);

  afterAll(async () => {
    await page?.close();
  });

  vi.setConfig({ testTimeout: 60_000 });

  it("u520_three_level_keyboard_walk", async () => {
    await page.load("/harness.html?seed=tree-40", 1280, 800);
    await page.until(`() => document.querySelector('[role=tree] [data-id="backend"]') !== null`);

    // Close the Shelf so its bar-to-panel Tab path does not precede the Rail.
    await page.call(`() => document.querySelector('#shelf-tab-todos').click()`);
    await page.until(`() => document.querySelector('#shelf-tab-todos')?.getAttribute('aria-expanded') === 'false'`);

    // Tab enters the Rail on its first row.
    for (let tabs = 0; tabs < 12 && !(await page.call<boolean>(`() => document.activeElement?.closest('[role=tree]') !== null`)); tabs += 1) await page.press("Tab", "Tab");

    await at("backend");
    await press("ArrowDown");
    await at("auth");
    await press("ArrowDown");
    await at("tokens");
    // Left on a leaf moves to its parent, which stays open.
    await press("ArrowLeft");
    await at("auth");
    await folded("auth", "true");
    // Left on an open branch folds it, then moves to its parent.
    await press("ArrowLeft");
    await folded("auth", "false");
    await at("auth");
    await press("ArrowLeft");
    await at("backend");
    // Right on an open branch moves to its first child; on a folded branch opens it, then enters it.
    await press("ArrowRight");
    await at("auth");
    await press("ArrowRight");
    await folded("auth", "true");
    await press("ArrowRight");
    await at("tokens");
    await press("Home");
    await at("backend");
    await press("End");
    expect(await page.call<boolean>(`() => { const rows = [...document.querySelectorAll('[role=tree] [data-part=item], [role=tree] [data-part=branch-control]')].filter((row) => row.checkVisibility()); return rows.at(-1) === document.activeElement; }`)).toBe(true);
    await press("Home");
    await at("backend");
    // A letter jumps to the row whose name begins with it.
    await press("m");
    await at("migrate");
  });

  it("u520_done_line_is_not_a_row", async () => {
    await page.load("/harness.html?seed=tree-40", 1280, 800);
    await page.until(`() => document.querySelector('[role=tree] [data-id="auth"]') !== null`);

    const rows = await page.call<string[]>(`() => [...document.querySelectorAll('[role=treeitem][data-id]')].map((row) => row.getAttribute('data-id'))`);

    // The done Agent is folded into a `✓ n done` line the user opens, and a line is no row: the walk never lands on it.
    expect(await page.call<number>(`() => document.querySelectorAll('.rail-fold').length`)).toBeGreaterThan(0);
    expect(rows).not.toContain("docs");
  });
});

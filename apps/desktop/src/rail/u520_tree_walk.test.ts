import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
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
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1280, 800);
    await page.until(`() => document.querySelector('[role=tree] [data-id="backend"]') !== null`);

    // Close the Shelf so its bar-to-panel Tab path does not precede the Rail.
    await page.call(`() => document.querySelector('#shelf-tab-todos').click()`);
    await page.until(`() => document.querySelector('.shelf')?.hidden === true`);

    // U4547a adds heading Tab stops; enter the first data row after its heading.
    for (let tabs = 0; tabs < 12 && !(await page.call<boolean>(`() => document.activeElement?.matches('[role=tree] [data-part=item], [role=tree] [data-part=branch-control]:not(.section-head)') === true`)); tabs += 1) await page.press("Tab", "Tab");

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
    await page.until(`() => document.activeElement?.matches('.section-head') === true`);
    expect(await page.call<boolean>(`() => document.activeElement === document.querySelector('.rail-tree .section-head')`)).toBe(true);
    await press("End");
    expect(await page.call<boolean>(`() => { const rows = [...document.querySelectorAll('[role=tree] [data-part=item], [role=tree] [data-part=branch-control]')].filter((row) => row.checkVisibility()); return rows.at(-1) === document.activeElement; }`)).toBe(true);
    await press("Home");
    await page.until(`() => document.activeElement?.matches('.section-head') === true`);
    expect(await page.call<boolean>(`() => document.activeElement === document.querySelector('.rail-tree .section-head')`)).toBe(true);
    // A letter jumps to the row whose name begins with it.
    await press("m");
    await at("migrate");
  });

  it("u520_done_line_is_not_a_row", async () => {
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1280, 800);
    await page.until(`() => document.querySelector('[role=tree] [data-id="auth"]') !== null`);

    const rows = await page.call<string[]>(`() => [...document.querySelectorAll('[role=treeitem][data-id]')].map((row) => row.getAttribute('data-id'))`);

    // The idle branch is a row; its hidden children are absent from the walk.
    expect(await page.call<number>(`() => document.querySelectorAll('.rail-fold').length`)).toBeGreaterThan(0);
    expect(rows).not.toContain("docs");
    expect(rows).toContain("fold:auth");
  });
});


run("u5483 folded children", () => {
  beforeAll(async () => { if (found) page = await openPage(found); }, 90_000);
  afterAll(async () => { await page?.close(); });
  it("u5483b_keyboard_walk_enters_only_open_children", async () => {
    await page.scheme("dark");
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1512, 950);
    await page.until(`() => !!document.querySelector('[data-id="fold:auth"]')`);
    await page.call(`() => document.querySelector('[data-id="fold:auth"] [data-part="branch-control"]').focus()`);
    await press("ArrowRight");
    await folded("fold:auth", "true");
    await press("ArrowRight");
    await at("docs");

    for (const id of ["U5483a", "U5483b", "U5483c"]) {
      const dir = captureDir(id);

      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "open.png"), Buffer.from(await page.shot(), "base64"));
        writeFileSync(join(dir, "open.checks.json"), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
      }
    }

    await press("ArrowLeft");
    await at("fold:auth");
    await press("ArrowLeft");
    await folded("fold:auth", "false");
    expect(await page.call<boolean>(`() => document.querySelector('[data-id="docs"]') === null`)).toBe(true);
  });
  it("u5483b_focus_survives_folding_and_return", async () => {
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1512, 950);
    await page.until(`() => !!document.querySelector('[data-id="fold:auth"]')`);
    await page.call(`() => document.querySelector('[data-id="fold:auth"] [data-part="branch-control"]').focus()`);
    await press("ArrowRight");
    await folded("fold:auth", "true");
    await press("ArrowRight");
    await at("docs");
    await page.call(`() => window.__fake.setStatus('docs', 'working', 'working')`);
    await at("docs");
    await page.call(`() => window.__fake.setStatus('docs', 'done', 'finished')`);
    await page.until(`() => !!document.querySelector('[data-id="fold:auth"]')`);
    await at("docs");
    await press("ArrowLeft");
    await at("fold:auth");
    await press("ArrowLeft");
    await folded("fold:auth", "false");
    await page.call(`() => window.__fake.setStatus('docs', 'working', 'working')`);
    await at("auth");
  });

});

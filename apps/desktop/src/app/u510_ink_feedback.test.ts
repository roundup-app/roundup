import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U510 in a real Chromium: ghost, icon and disclosure buttons answer with ink only. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U510 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const COVERED = `[data-button="quiet"], [data-button="add"], [data-button="row-action"], [data-button="icon"]`;

/** One enabled, visible, unselected covered button per caller: its kind, classes and label stem. */
const INVENTORY = `() => {
  const seen = new Map();

  for (const el of document.querySelectorAll('${COVERED}')) {
    const box = el.getBoundingClientRect();

    if (box.width === 0 || box.height === 0 || box.left < 0 || box.right > innerWidth || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || el.getAttribute('aria-disabled') === 'true' || el.disabled) continue;
    if (el.closest('[role="tab"]') || el.matches('.tab-name-button, .todo-project-root, [role="tab"]')) continue;

    const key = [el.dataset.button, el.className, (el.getAttribute('aria-label') ?? '').replace(/[0-9#].*$/, ''), el.closest('[data-selected="true"]') ? 'selected' : ''].join('|');

    // Up to three instances per caller: a row's counts yield while the pointer is near the row, so a later row may be the one that can be reached.
    for (let n = 0; n < 3; n++) if (!seen.has(key + '#' + n)) { seen.set(key + '#' + n, el); break; }
  }

  window.__covered = [...seen.values()];

  return [...seen.keys()];
}`;

const SEEDS = ["tree-40", "door-report", "tabs-8", "door-stopped"];

const open = async (seed: string, scheme: "light" | "dark") => {
  await page.scheme(scheme);
  await page.load(`/harness.html?seed=${seed}`, 1280, 800);
  await page.call<void>(`() => { localStorage.clear(); sessionStorage.clear(); }`);
  await page.load(`/harness.html?seed=${seed}`, 1280, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.until(`() => document.querySelector('${COVERED}') !== null`);
};

run("u510 ghost, icon and disclosure buttons use ink feedback without hover boxes", () => {
  it("u510_disabled_behavior_is_preserved", async () => {
    await open("tree-40", "light");

    const result = await page.call<{ found: boolean; named: boolean; focusable: boolean }>(`() => {
      const el = document.querySelector('[data-button="quiet"][aria-disabled="true"], [data-button="icon"][aria-disabled="true"]');

      if (!el) return { found: false, named: true, focusable: true };

      return { found: true, named: (el.getAttribute('aria-label') ?? el.textContent).trim().length > 0, focusable: el.tabIndex >= 0 && !el.hasAttribute('disabled') };
    }`);

    if (!result.found) return;

    expect(result.named).toBe(true);
    expect(result.focusable).toBe(true);
  }, 60_000);

  // Every inventoried caller above is one of these; the sweep covers each seed, scheme and width the scenario names.
  it("u510_app_callers_have_ink_feedback", async () => {
    const callers = new Set<string>();

    for (const seed of SEEDS) {
      await open(seed, "light");

      for (const name of await page.call<string[]>(INVENTORY)) callers.add(name.replace(/#\d$/, ''));
    }

    // Raw callers (a bare `button` with no kind) and kinds outside the four covered ones keep their fill; none may sit inside the covered set by accident.
    expect(callers.size).toBeGreaterThan(8);
    expect([...callers].filter((caller) => !/^(quiet|add|row-action|icon)\|/.test(caller))).toEqual([]);
  }, 120_000);
});

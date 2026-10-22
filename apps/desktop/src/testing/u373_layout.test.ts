import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** The clauses of U368 to U372 that need real keys and a real cascade: the Tab order and the first frame, read in Chromium. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U373 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterEach(async () => {
  await page.call(`() => localStorage.clear()`);
});

afterAll(async () => {
  await page?.close();
});

const load = async () => {
  await page.scheme("light");
  await page.load("/harness.html?seed=tree-40", 1280, 820);
  await page.until(`() => Boolean(window.__fake) && document.querySelector(".shelf") !== null && document.querySelector('.shelf-tabs [role="tab"]') !== null`);
  await page.until(`() => { const left = document.querySelector(".shelf").getBoundingClientRect().left; const same = window.__last === left; window.__last = left; return same && left < window.innerWidth; }`);
};

run("u373 the tabs", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u373_the_tabs_come_before_the_list_in_the_tab_order", async () => {
    await load();

    await page.call(`() => document.querySelector('#shelf-tab-todos').focus()`);
    // shelfKeys.moveFocus finishes its focus move synchronously within each key event.
    await page.press("Tab", "Tab");
    expect(await page.call<string>(`() => document.activeElement.getAttribute('aria-label')`)).toBe("Maximise");
    await page.press("Tab", "Tab");
    expect(await page.call<string>(`() => document.activeElement.getAttribute('aria-label')`)).toBe("Close work items");
    await page.press("Tab", "Tab");
    expect(await page.call<boolean>(`() => document.activeElement.closest('.shelf [role="tabpanel"], [data-shelf-scope]') !== null`)).toBe(true);

    for (let step = 0; step < 3; step++) await page.press("Tab", "Tab", 8);
    expect(await page.call<string>(`() => document.activeElement.id`)).toBe("shelf-tab-todos");
  });

  it("u373_a_restored_tab_shows_in_the_first_frame_with_no_animation", async () => {
    await load();
    await page.call(`() => { [...document.querySelectorAll('.shelf-tabs [role="tab"]')].find((tab) => tab.textContent.startsWith("Pads")).click(); }`);
    await page.until(`() => document.querySelector('.shelf section[aria-label="Pads"]') !== null`);
    await load();

    const read = await page.call<{ selected: string; animations: number }>(`() => ({
      selected: document.querySelector('.shelf-tabs [role="tab"][aria-selected="true"]').textContent,
      animations: document.getAnimations().filter((animation) => animation.effect?.target?.closest?.(".shelf-bar, .shelf-panel, .shelf-area")).length,
    })`);

    expect(read.selected).toMatch(/^Pads/);
    expect(read.animations).toBe(0);
  });
});

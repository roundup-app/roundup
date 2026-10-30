import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** The clause of U368 to U372 that needs real keys: the Tab order, read in Chromium. */

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
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1280, 820);
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
    expect(await page.call<boolean>(`() => document.activeElement === document.querySelector('.shelf-controls button:last-child')`)).toBe(true);
    await page.press("Tab", "Tab");
    expect(await page.call<boolean>(`() => document.activeElement.closest('.shelf [role="tabpanel"], [data-shelf-scope]') !== null`)).toBe(true);

    // CDP uses bit 3 for Shift; each press sends exactly one Shift+Tab.
    const shift = 1 << 3;
    let steps = 0;

    // Stop outside the Shelf too, so a window cycle cannot hide a wrong order.
    for (; steps < 64; steps++) {
      await page.press("Tab", "Tab", shift);

      if (await page.call<boolean>(`() => document.activeElement.closest('.shelf-tabs') !== null || document.activeElement.closest('.shelf') === null`)) break;
    }

    expect(steps, "Shift+Tab did not leave the Shelf panel within 64 presses").toBeLessThan(64);
    expect(await page.call<string>(`() => document.activeElement.id`)).toBe("shelf-tab-todos");
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U379 in a real Chromium: every line of a Shelf row is a click target where the row washes. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U379 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Line = { list: string; row: number; line: string; x: number; y: number };

const TAB = `async (list) => {
  const tab = [...document.querySelectorAll('.shelf-tabs [role="tab"]')].find((own) => own.textContent.toLowerCase().startsWith(list));
  if (tab.getAttribute("aria-selected") !== "true") tab.click();
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
}`;

const TITLE = ":is(.todo-row-button, .pad-name)";

/** Page-side: the centre of every line of the first row of `list`, the Tab selected first. */
const LINES = `async (list) => {
  await (${TAB})(list);
  const out = [];
  [...document.querySelectorAll('.shelf section[aria-label="' + list + '" i] .shelf-row')].slice(0, 1).forEach((row, index) => {
    for (const line of row.querySelectorAll(":scope > .shelf-head, :scope > .shelf-text > *")) {
      const target = line.matches(".row-head, .shelf-head") ? line.querySelector("${TITLE}") : line;
      const box = target.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && target.checkVisibility({opacityProperty:true})) out.push({ list, row: index, line: target.className || target.tagName, x: box.left + box.width / 2, y: box.top + box.height / 2 });
    }
  });
  return out;
}`;

run("u379 where a Shelf row washes, a click acts", () => {
  vi.setConfig({ testTimeout: 60_000 });

  const [scheme, width, height] = ["light", 1280, 800] as const;

  it(`u3789a_every_visible_row_line_selects_without_opening on tree-40 ${scheme} at ${width}x${height}`, async () => {
    await page.scheme(scheme);
    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", width, height);
    await page.until(`() => document.querySelector(".shelf .shelf-row") !== null`);
    await page.call(TAB, "todos");
    await page.call(`() => document.querySelector('.shelf [data-shelf-group="unassigned"][data-state="closed"] [data-part="branch-control"]')?.click()`);

    for (const list of ["todos", "pads"]) {
      const lines = await page.call<Line[]>(LINES, list);

      if (lines.length === 0) throw new Error(`No ${list} row content in the fixture`);

      for (const line of lines) {
        await page.click(line.x, line.y);
        await page.until(`() => document.activeElement?.matches("${TITLE}")`);
      }

      expect(await page.call<unknown[]>(`() => window.__fake.app.calls.filter(call => ['pad.read','todo.getHistory','todo.readHistory'].includes(call.method))`)).toEqual([]);
    }
  });

});

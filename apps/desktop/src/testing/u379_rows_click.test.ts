import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U379 in a real Chromium: every line of a Shelf row is a click target where the row washes. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U379");

beforeAll(async () => {
  if (!found) throw new Error("U379 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Line = { list: string; row: number; line: string; x: number; y: number };

type Read = { button: boolean; cursor: string; element: string; top: number; height: number; hovered: boolean };

const LINES = `async () => { const out = []; for (const list of ["todos", "pads"]) {
  const tab = [...document.querySelectorAll('.shelf [role="tab"]')].find((own) => own.textContent.toLowerCase().startsWith(list));
  if (tab.getAttribute("aria-selected") !== "true") tab.click();
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  [...document.querySelectorAll('.shelf section[aria-label="' + list + '"] .shelf-row')].slice(0, 3).forEach((row, index) => {
    for (const line of [...row.querySelector(".shelf-text").children].filter((own) => !own.matches(".row-head") || true)) {
      const target = line.matches(".row-head") ? line.querySelector(".todo-row-button") : line;
      const box = target.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) out.push({ list, row: index, line: target.className || target.tagName, x: box.left + 4, y: box.top + box.height / 2 });
    }
  });
} return out; }`;

const READ = (x: number, y: number) => `() => { const at = document.elementFromPoint(${x}, ${y}); const row = at.closest(".shelf-row") ?? at; const box = row.getBoundingClientRect(); return { button: at.closest("button") !== null, cursor: getComputedStyle(at).cursor, element: at.tagName + "." + at.className, top: box.top, height: box.height, hovered: row.matches(":hover") || at.matches(":hover") }; }`;

run("u379 where a Shelf row washes, a click acts", () => {
  vi.setConfig({ testTimeout: 60_000 });

  for (const scheme of ["light", "dark"] as const)
    for (const [width, height] of [[1280, 820], [700, 800]] as const)
      it(`u379_every_line_of_a_row_is_a_click_target on tree-40 ${scheme} at ${width}x${height}`, async () => {
        await page.scheme(scheme);
        await page.load("/harness.html?seed=tree-40", width, height);
        await page.until(`() => document.querySelector(".shelf .shelf-row") !== null`);

        const lines = await page.call<Line[]>(LINES);
        const reads: Array<Line & Read> = [];

        expect(lines.length).toBeGreaterThan(0);

        for (const line of lines) {
          await page.call(`() => window.__tab?.("${line.list}")`).catch(() => undefined);
          await page.hover(line.x, line.y);
          const read = await page.call<Read>(READ(line.x, line.y));

          reads.push({ ...line, ...read });
          expect(read.hovered, JSON.stringify(line)).toBe(true);
          expect(read.button, `${line.list} row ${line.row} ${line.line}: ${read.element}`).toBe(true);
          expect(read.cursor, `${line.list} row ${line.row} ${line.line}`).not.toBe("auto");
        }

        mkdirSync(ART, { recursive: true });
        writeFileSync(resolve(ART, `tree-40-${scheme}-${width}x${height}.json`), `${JSON.stringify(reads, null, 2)}\n`);
      });

  it("u379_the_row_still_reorders_and_keeps_its_boxes", async () => {
    await page.load("/harness.html?seed=tree-40", 1280, 820);
    await page.until(`() => document.querySelector(".shelf .shelf-row") !== null`);

    const at = await page.call<{ x: number; y: number }>(`() => { const box = document.querySelector(".shelf .shelf-row :is(.todo-row-button, .pad-name)").getBoundingClientRect(); return { x: box.left + 4, y: box.top + box.height / 2 }; }`);
    const before = await page.call<Read>(READ(at.x, at.y));

    await page.hover(at.x, at.y);

    const after = await page.call<Read>(READ(at.x, at.y));

    expect([after.top, after.height]).toEqual([before.top, before.height]);
  });
});

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { captureDir } from "./captures";

/** U379 in a real Chromium: every line of a Shelf row is a click target where the row washes. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = captureDir("U379");

beforeAll(async () => {
  if (!found) throw new Error("U379 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Line = { list: string; row: number; line: string; x: number; y: number };

type Read = { button: boolean; sameButton: boolean; cursor: string; element: string; top: number; height: number; hovered: boolean };

const TAB = `async (list) => {
  const tab = [...document.querySelectorAll('.shelf [role="tab"]')].find((own) => own.textContent.toLowerCase().startsWith(list));
  if (tab.getAttribute("aria-selected") !== "true") tab.click();
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
}`;

const ROWS = (list: string) => `document.querySelectorAll('.shelf section[aria-label="${list}"] .shelf-row')`;

const TITLE = ":is(.todo-row-button, .pad-name)";

/** Page-side: the centre of every line of the first three rows of `list`, the Tab selected first. */
const LINES = `async (list) => {
  await (${TAB})(list);
  const out = [];
  [...document.querySelectorAll('.shelf section[aria-label="' + list + '"] .shelf-row')].slice(0, 3).forEach((row, index) => {
    for (const line of row.querySelector(".shelf-text").children) {
      const target = line.matches(".row-head") ? line.querySelector("${TITLE}") : line;
      const box = target.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) out.push({ list, row: index, line: target.className || target.tagName, x: box.left + box.width / 2, y: box.top + box.height / 2 });
    }
  });
  return out;
}`;

const READ = (x: number, y: number) => `() => { const at = document.elementFromPoint(${x}, ${y}); const row = at.closest(".shelf-row") ?? at; const box = row.getBoundingClientRect(); return { button: at.closest("button") !== null, sameButton: at.closest("button") === row.querySelector("${TITLE}"), cursor: getComputedStyle(at).cursor, element: at.tagName + "." + at.className, top: box.top, height: box.height, hovered: row.matches(":hover") || at.matches(":hover") }; }`;

/** The Drawer's state: open or not, and what it shows. */
const DRAWER = `() => { const drawer = document.querySelector('aside[aria-label="drawer"]'); return { open: drawer.getAttribute("data-open") === "true", text: (drawer.querySelector(".pad-head-name") ?? drawer).textContent }; }`;

const CLOSE = `async () => { document.querySelector('aside[aria-label="drawer"] .close')?.click(); await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); }`;

const OPEN = `async () => { await new Promise((done) => setTimeout(done, 150)); }`;

type Shown = { open: boolean; text: string };

const opened = async (x: number, y: number): Promise<Shown> => {
  await page.call(CLOSE);
  await page.click(x, y);
  await page.call(OPEN);

  return page.call<Shown>(DRAWER);
};

run("u379 where a Shelf row washes, a click acts", () => {
  vi.setConfig({ testTimeout: 60_000 });

  for (const scheme of ["light", "dark"] as const)
    for (const [width, height] of [[1280, 820], [700, 800]] as const)
      it(`u379_every_line_of_a_row_is_a_click_target on tree-40 ${scheme} at ${width}x${height}`, async () => {
        await page.scheme(scheme);
        await page.load("/harness.html?seed=tree-40", width, height);
        await page.until(`() => document.querySelector(".shelf .shelf-row") !== null`);

        const reads: Array<Line & Read & { drawer: string }> = [];

        for (const list of ["todos", "pads"]) {
          const lines = await page.call<Line[]>(LINES, list);

          expect(lines.length, list).toBeGreaterThan(0);
          expect(new Set(lines.map((line) => line.row)).size, `${list} rows read`).toBeGreaterThan(1);

          for (const line of lines) {
            await page.call(LINES, list);
            await page.call(CLOSE);
            await page.hover(line.x, line.y);

            const read = await page.call<Read>(READ(line.x, line.y));
            const box = await page.call<{ x: number; y: number }>(`() => { const box = ${ROWS(list)}[${line.row}].querySelector("${TITLE}").getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; }`);
            const title = await opened(box.x, box.y);
            const shown = await opened(line.x, line.y);

            reads.push({ ...line, ...read, drawer: shown.text.slice(0, 30) });
            expect(read.hovered, JSON.stringify(line)).toBe(true);
            expect(read.button, `${list} row ${line.row} ${line.line}: ${read.element}`).toBe(true);
            expect(read.sameButton, `${list} row ${line.row} ${line.line}: ${read.element} is not the row's title button`).toBe(true);
            expect(read.cursor, `${list} row ${line.row} ${line.line}`).not.toBe("auto");
            expect(title.open, `${list} row ${line.row} title opens the Drawer`).toBe(true);
            expect(shown.open, `${list} row ${line.row} ${line.line} opens the Drawer`).toBe(true);
            expect(shown.text.slice(0, 30), `${list} row ${line.row} ${line.line} opens the same Drawer as its title`).toBe(title.text.slice(0, 30));
          }
        }

        if (!ART) return;
        mkdirSync(ART, { recursive: true });
        writeFileSync(resolve(ART, `tree-40-${scheme}-${width}x${height}.json`), `${JSON.stringify(reads, null, 2)}\n`);
      });

  it("u379_the_row_still_reorders_and_keeps_its_boxes", async () => {
    await page.scheme("light");
    await page.load("/harness.html?seed=tree-40", 1280, 820);
    await page.until(`() => document.querySelector(".shelf .shelf-row") !== null`);
    await page.call(TAB, "todos");

    const at = await page.call<{ x: number; y: number }>(`() => { const box = ${ROWS("todos")}[0].querySelector("${TITLE}").getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; }`);
    const before = await page.call<Read>(READ(at.x, at.y));

    await page.hover(at.x, at.y);

    const after = await page.call<Read>(READ(at.x, at.y));

    expect([after.top, after.height]).toEqual([before.top, before.height]);

    // Tab order and focus ring: the title button takes focus from the keyboard and shows a ring.
    const focused = await page.call<{ same: boolean; ring: string }>(`() => { const own = ${ROWS("todos")}[0].querySelector("${TITLE}"); own.focus({ focusVisible: true }); return { same: document.activeElement === own, ring: getComputedStyle(own, "::after").outlineStyle + getComputedStyle(own).outlineStyle + getComputedStyle(own).boxShadow }; }`);

    expect(focused.same).toBe(true);
    expect(focused.ring).not.toMatch(/^nonenonenone$/);

    // ⌥↓ moves the focused row down one place.
    const order = `() => [...${ROWS("todos")}].map((row) => row.getAttribute("data-id"))`;
    const first = await page.call<string[]>(order);

    await page.press("ArrowDown", "ArrowDown", 1);
    await page.until(`() => ${order.slice(6)}[0] !== ${JSON.stringify(first[0])}`);

    const moved = await page.call<string[]>(order);

    expect(moved[1]).toBe(first[0]);

    // U136: no Check passing on `main` regresses; D2, D10 and D14 already fail there on `tree-40`.
    const checks = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

    expect(Object.entries(checks).filter(([, check]) => check.status === "fail").map(([id]) => id).filter((id) => !["D2", "D10", "D14"].includes(id))).toEqual([]);
  });
});

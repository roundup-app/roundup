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
  const tab = [...document.querySelectorAll('.shelf [role="tab"]')].find((own) => own.textContent.toLowerCase().startsWith(list));
  if (tab.getAttribute("aria-selected") !== "true") tab.click();
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
}`;

const ROWS = (list: string) => `document.querySelectorAll('.shelf section[aria-label="${list}" i] .shelf-row')`;

const TITLE = ":is(.todo-row-button, .pad-name)";

/** Page-side: the centre of every line of the first three rows of `list`, the Tab selected first. */
const LINES = `async (list) => {
  await (${TAB})(list);
  const out = [];
  [...document.querySelectorAll('.shelf section[aria-label="' + list + '" i] .shelf-row')].slice(0, 3).forEach((row, index) => {
    for (const line of row.querySelectorAll(":scope > .shelf-head, :scope > .shelf-text > *")) {
      const target = line.matches(".row-head, .shelf-head") ? line.querySelector("${TITLE}") : line;
      const box = target.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) out.push({ list, row: index, line: target.className || target.tagName, x: box.left + box.width / 2, y: box.top + box.height / 2 });
    }
  });
  return out;
}`;

/** The Drawer's state: open or not, and what it shows. */
const DRAWER = `() => { const drawer = document.querySelector('aside[aria-label="Drawer"]'); return { open: drawer.getAttribute("data-open") === "true", text: (drawer.querySelector(".pad-head-name") ?? drawer).textContent }; }`;

const CLOSE = `async () => { document.querySelector('aside[aria-label="Drawer"] .close')?.click(); await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().map(animation => animation.finished)); }`;

const OPEN = `async () => { await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().map(animation => animation.finished)); }`;

type Shown = { open: boolean; text: string };

const opened = async (x: number, y: number): Promise<Shown> => {
  await page.call(CLOSE);
  await page.click(x, y);
  await page.call(OPEN);

  return page.call<Shown>(DRAWER);
};

run("u379 where a Shelf row washes, a click acts", () => {
  vi.setConfig({ testTimeout: 60_000 });

  const [scheme, width, height] = ["light", 1280, 800] as const;

  it(`u379_every_line_of_a_row_is_a_click_target on tree-40 ${scheme} at ${width}x${height}`, async () => {
    await page.scheme(scheme);
    await page.load("/harness.html?seed=tree-40", width, height);
    await page.until(`() => document.querySelector(".shelf .shelf-row") !== null`);

    for (const list of ["todos", "pads"]) {
      const lines = await page.call<Line[]>(LINES, list);

      expect(lines.length, list).toBeGreaterThan(0);
      expect(new Set(lines.map((line) => line.row)).size, `${list} rows read`).toBeGreaterThan(1);

      for (const line of lines) {
        await page.call(LINES, list);
        await page.call(CLOSE);
        const box = await page.call<{ x: number; y: number }>(`() => { const box = ${ROWS(list)}[${line.row}].querySelector("${TITLE}").getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; }`);
        const title = await opened(box.x, box.y);
        const shown = await opened(line.x, line.y);

        expect(title.open, `${list} row ${line.row} title opens the Drawer`).toBe(true);
        expect(shown.open, `${list} row ${line.row} ${line.line} opens the Drawer`).toBe(true);
        expect(shown.text.slice(0, 30), `${list} row ${line.row} ${line.line} opens the same Drawer as its title`).toBe(title.text.slice(0, 30));
      }
    }
  });

  it("u379_the_row_still_reorders_and_keeps_its_focus", async () => {
    await page.scheme("light");
    await page.load("/harness.html?seed=tree-40", 1280, 820);
    await page.until(`() => document.querySelector(".shelf .shelf-row") !== null`);
    await page.call(TAB, "todos");

    // Tab order: the title button takes focus from the keyboard.
    const focused = await page.call<boolean>(`() => { const own = ${ROWS("todos")}[0].querySelector("${TITLE}"); own.focus({ focusVisible: true }); return document.activeElement === own; }`);

    expect(focused).toBe(true);

    // ⌥↓ moves the focused row down one place.
    const order = `() => [...${ROWS("todos")}].map((row) => row.getAttribute("data-id"))`;
    const first = await page.call<string[]>(order);

    await page.press("ArrowDown", "ArrowDown", 1);
    await page.until(`() => ${order.slice(6)}[0] !== ${JSON.stringify(first[0])}`);

    const moved = await page.call<string[]>(order);

    expect(moved[1]).toBe(first[0]);
  });
});

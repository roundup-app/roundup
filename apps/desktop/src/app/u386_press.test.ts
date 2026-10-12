import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U386 in a real Chromium: jsdom does not match `:active`. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U386 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});


const CENTRE = (selector: string) => `() => { const r = ${selector}.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }`;

const BUTTON = `document.querySelector('.rail-row [aria-label^="Collapse"]')`;

const ROW = `${BUTTON}.closest('.rail-row')`;

const BG = (selector: string) => `() => getComputedStyle(${selector}).backgroundColor`;

/** The wash a row draws is a `background-image` layer (U381). */
const WASH = (selector: string) => `() => getComputedStyle(${selector}).backgroundImage`;

const PRESSED_WASH = `() => { const probe = document.createElement("i"); probe.style.backgroundImage = "linear-gradient(var(--pressed), var(--pressed))"; document.body.append(probe); const c = getComputedStyle(probe).backgroundImage; probe.remove(); return c; }`;

const PRESSED = `() => { const probe = document.createElement("i"); probe.style.backgroundColor = "var(--pressed)"; document.body.append(probe); const c = getComputedStyle(probe).backgroundColor; probe.remove(); return c; }`;

run("u386 a press shows on the target under the pointer only", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`u386_press_on_a_row_button_leaves_the_row_at_rest_${scheme}`, async () => {
      await page.scheme(scheme);
      await page.load("/harness.html?seed=tree-40", 1280, 800);
      await page.until(`() => Boolean(window.__fake) && ${BUTTON} !== null`);
      // The Rail may still be settling: wait until the chevron has stopped.
      await page.until(`() => { const left = ${BUTTON}.getBoundingClientRect().left; const same = window.__left === left; window.__left = left; return same; }`);

      const [rowX, rowY] = await page.call<[number, number]>(`() => { const r = ${ROW}.getBoundingClientRect(); return [r.right - 4, r.top + r.height / 2]; }`);
      const pressed = await page.call<string>(PRESSED);
      const pressedWash = await page.call<string>(PRESSED_WASH);

      await page.hover(0, 0);
      const rest = await page.call<string>(WASH(ROW));

      // Hovering the row first: the chevron's box is the one under the pointer once the row is hovered.
      await page.hover(rowX - 100, rowY);
      const [x, y] = await page.call<[number, number]>(CENTRE(BUTTON));

      await page.hover(x, y);
      const hover = await page.call<string>(BG(BUTTON));

      await page.down(x, y);
      expect(await page.call<string>(WASH(ROW))).toBe(rest);
      expect(await page.call<string>(BG(BUTTON))).not.toBe(hover);
      expect(await page.call<string>(BG(BUTTON))).toBe(pressed);
      await page.release(x, y);

      await page.hover(0, 0);
      expect(await page.call<string>(WASH(ROW))).toBe(rest);

      await page.down(rowX, rowY);
      // A selected row keeps its accent bar layer above the wash (U381).
      expect(await page.call<string>(WASH(ROW))).toMatch(new RegExp(`${pressedWash.replace(/[()]/g, "\\$&")}$`));
      await page.release(rowX, rowY);
    }, 60_000);
  }

  it("u386_press_on_a_shelf_row_button_leaves_the_row_at_rest", async () => {
    const complete = `document.querySelector('.shelf [data-id] [data-button="row-action"]')`;
    const title = `document.querySelector('.shelf [data-id] .todo-row-button')`;
    const row = `${title}.closest('.shelf-row')`;

    await page.scheme("light");
    await page.load("/harness.html?seed=tree-40", 1280, 800);
    // The earlier tests' presses may have left a scope in storage.
    await page.call<void>(`() => { localStorage.clear(); sessionStorage.clear(); }`);
    await page.load("/harness.html?seed=tree-40", 1280, 800);
    await page.until(`() => Boolean(window.__fake)`);
    await page.until(`() => ${title} !== null`);

    await page.hover(0, 0);
    const rest = await page.call<string>(WASH(row));
    const [tx, ty] = await page.call<[number, number]>(CENTRE(title));

    // The row's actions appear while it is hovered.
    await page.hover(tx, ty);
    await page.until(`() => ${complete} !== null`);
    const [x, y] = await page.call<[number, number]>(CENTRE(complete));

    await page.hover(x, y);
    await page.down(x, y);
    expect(await page.call<string>(WASH(row))).not.toContain(await page.call<string>(PRESSED_WASH));
    await page.release(x, y);
    await page.hover(0, 0);
    expect(await page.call<string>(WASH(row))).toBe(rest);
  }, 60_000);
});

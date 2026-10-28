import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage, type ChromePage } from "../testing/chromePage";

type Point = { x: number; y: number };

const SIZES = [{ width: 1280, height: 800 }] as const;

const found = chromePath();

const run = found ? describe : describe.skip;

let browser: ChromePage;

beforeAll(async () => {
  if (found) browser = await openPage(found);
}, 90_000);

afterAll(async () => { await browser?.close(); });

const pointOf = (selector: string, at: { dx?: number; fx?: number; nth?: number } = {}) =>
  browser.call<Point>(
    `function (selector, dx, fx, nth) {
      const element = [...document.querySelectorAll(selector)][nth];
      if (!element) throw new Error("no " + selector);
      element.scrollIntoView({ block: "nearest" });
      const box = element.getBoundingClientRect();
      return { x: box.left + dx + box.width * fx, y: box.top + box.height / 2 };
    }`,
    selector, at.dx ?? 0, at.fx ?? 0, at.nth ?? 0,
  );

const selected = () => browser.call<string>("() => window.getSelection().toString()");

const load = async (size: { width: number; height: number }) => {
  await browser.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", size.width, size.height);
  await browser.until(`() => Boolean(window.__fake && window.__fake.app.calls.some((call) => call.method === "pad.list") && document.querySelector(".rail-fold button"))`);
  await browser.call("() => window.getSelection().removeAllRanges()");
};

const calls = (method: string) =>
  browser.call<unknown[]>(`(method) => window.__fake.app.calls.filter((call) => call.method === method).map((call) => call.params)`, method);

const drag = async (from: Point, to: Point) => {
  await browser.pointer("move", from.x, from.y);
  await browser.pointer("down", from.x, from.y);

  for (let step = 1; step <= 8; step++) {
    await browser.pointer("move", from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);
  }

  await browser.pointer("up", to.x, to.y);
};

const editName = async (nth: number) => {
  const at = await pointOf(".rail-row", { dx: 2, nth });

  await browser.click(at.x, at.y);
  await browser.until(`() => document.querySelectorAll(".rail-row")[${nth}].dataset.selected === "true"`);
  await browser.call(`nth => document.querySelectorAll(".rail-row .name")[nth].closest(".rail-row").focus()`, nth);
  await browser.press("F2", "F2");
  await browser.until(`() => document.activeElement?.matches(".rail-row input") && document.activeElement.selectionEnd > document.activeElement.selectionStart`);
};

run("u142 the Rail selects rows, not browser text", () => {
  it("u142_the_drag_helper_selects_text_where_the_browser_allows_it", async () => {
    await load(SIZES[0]);
    await browser.call(`() => document.body.insertAdjacentHTML("afterbegin", '<p id="ctl" style="position:fixed;top:0;left:400px;margin:0;z-index:99;background:white;color:black;user-select:text;-webkit-user-select:text">selectable control text</p>')`);
    await drag(await pointOf("#ctl", { dx: 2 }), await pointOf("#ctl", { fx: 1, dx: -2 }));
    expect(await selected()).not.toBe("");
  }, 30_000);

  for (const size of SIZES) {
    const at = `${size.width}x${size.height}`;

    /** Each attempt: where the press lands and where it is released. */
    const attempts: [string, () => Promise<[Point, Point]>][] = [
      ["within a name, left to right", async () => [await pointOf(".rail-row .name", { dx: 1 }), await pointOf(".rail-row .name", { fx: 1, dx: -1 })]],
      ["from the gap right of a name across the rows below", async () => [await pointOf(".rail-row", { fx: 1, dx: -3 }), await pointOf(".rail-row", { dx: 2, nth: 3 })]],
    ];

    for (const [name, aim] of attempts) {
      it(`u142_${at}_a_drag_${name.replaceAll(/[^a-z0-9]+/gi, "_")}_leaves_no_selection`, async () => {
        await load(size);
        const [from, to] = await aim();

        await drag(from, to);
        expect(await selected()).toBe("");
      }, 30_000);
    }

    it(`u142_${at}_dragging_in_the_rename_input_selects_its_text_and_moves_no_row`, async () => {
      await load(size);
      await editName(2);
      // A selection drag must start from a caret: dragging an existing selection moves text on macOS.
      const caret = await pointOf(".rail-row input", { dx: 2 });

      await browser.click(caret.x, caret.y);
      await browser.until(`() => document.activeElement?.matches(".rail-row input") && document.activeElement.selectionEnd === document.activeElement.selectionStart`);
      expect(await browser.call<boolean>(`() => document.querySelector(".rail-row input").selectionEnd === document.querySelector(".rail-row input").selectionStart`)).toBe(true);
      await drag(await pointOf(".rail-row input", { dx: 2 }), await pointOf(".rail-row input", { dx: 30 }));
      await browser.until(`() => document.querySelector(".rail-row input")?.selectionEnd > document.querySelector(".rail-row input")?.selectionStart`);
      expect(await browser.call<boolean>(`() => document.querySelector(".rail-row input").selectionEnd > document.querySelector(".rail-row input").selectionStart`)).toBe(true);
      expect(await calls("rail.move")).toEqual([]);
    }, 30_000);
  }
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U381 in a real Chromium: every state of a selected and an unselected row, read as the computed wash layers. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U381 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Layer = { color: string; alpha: number };

type Read = { layers: Layer[]; backgroundColor: string; bar: boolean };

type State = "rest" | "hover" | "press";

const KINDS = [".rail-row", ".shelf-row"] as const;

/** Page-side: marks one row of `kind` selected (or none), and returns the centre of the chosen row. A selected row not yet in the page takes the mark by attribute, which is all the CSS reads. */
const PICK = `(kind, selected) => {
  const rows = [...document.querySelectorAll(kind)].filter((row) => row.getBoundingClientRect().height > 0);
  for (const row of rows) row.removeAttribute("data-selected");
  const row = rows[selected ? 1 : 0];
  if (selected) row.setAttribute("data-selected", "true");
  const box = row.getBoundingClientRect();
  window.__row = row;
  // U426 puts buttons in the trailing half; measure the row's wash on its leading inset, where no button's own wash suppresses it (buttons.css).
  return { x: kind === ".rail-row" ? box.left + 1 : box.left + box.width / 2, y: box.top + 4 };
}`;

/** Page-side: the picked row's wash layers by computed `background-image`, plus its `background-color` and whether a 2px bar layer leads. */
const READ = `() => {
  const style = getComputedStyle(window.__row);
  const colors = style.backgroundImage.match(/rgba?\\([^)]*\\)/g) ?? [];
  const layers = [];
  // The Tree paints an unselected row's hover and press as a background colour: one wash, read as one layer.
  const fill = style.backgroundColor.match(/[\\d.]+/g).map(Number);
  if (!colors.length && (fill.length < 4 || fill[3] > 0)) layers.push({ color: style.backgroundColor, alpha: fill.length > 3 ? fill[3] : 1 });
  for (let at = 0; at < colors.length; at += 2) {
    const numbers = colors[at].match(/[\\d.]+/g).map(Number);
    layers.push({ color: colors[at], alpha: numbers.length > 3 ? numbers[3] : 1 });
  }
  const sizes = style.backgroundSize.split(/,\\s*(?![^(]*\\))/);
  return { layers, backgroundColor: style.backgroundColor, bar: sizes[0].startsWith("2px") && layers.length > 1 };
}`;

const measure = async (kind: string, selected: boolean, state: State): Promise<Read> => {
  const at = await page.call<{ x: number; y: number }>(PICK, kind, selected);

  await page.pointer("move", 1, 1);

  if (state !== "rest") await page.pointer("move", at.x, at.y);

  if (state === "press") await page.pointer("down", at.x, at.y);

  const read = await page.call<Read>(READ);

  if (state === "press") {
    await page.pointer("move", 1, 1);
    await page.pointer("up", 1, 1);
  }

  return read;
};

/** The alpha of the one wash layer: the last layer, after the bar when selected. */
const wash = (read: Read, selected: boolean): number => {
  expect(read.layers.length).toBe(selected ? 2 : read.layers.length);

  return read.layers.at(-1)?.alpha ?? 0;
};

run("u381 a selected row answers the pointer with a darker step", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const kind of KINDS) {
      it(`u381_${kind.slice(1).replace("-", "_")}_climbs_the_ladder_in_${scheme}`, async () => {
        await page.scheme(scheme);
        await page.load("/harness.html?seed=tree-40", 1280, 800);
        await page.until(`() => document.querySelectorAll("${kind}").length > 2`);

        const plain: Record<State, Read> = { rest: await measure(kind, false, "rest"), hover: await measure(kind, false, "hover"), press: await measure(kind, false, "press") };
        const chosen: Record<State, Read> = { rest: await measure(kind, true, "rest"), hover: await measure(kind, true, "hover"), press: await measure(kind, true, "press") };

        // Unselected: rest < hover < press, one wash layer once touched, none at rest.
        expect(plain.rest.layers.length).toBe(0);
        expect(plain.hover.layers.length).toBe(1);
        expect(plain.press.layers.length).toBe(1);
        expect(wash(plain.rest, false)).toBe(0);
        expect(wash(plain.hover, false)).toBeGreaterThan(0);
        expect(wash(plain.press, false)).toBeGreaterThan(wash(plain.hover, false));

        // Selected: the bar plus exactly one wash in every state, strictly rising.
        for (const state of ["rest", "hover", "press"] as const) {
          expect(chosen[state].layers.length).toBe(2);
          expect(chosen[state].bar).toBe(true);
        }

        const [rest, hover, press] = [wash(chosen.rest, true), wash(chosen.hover, true), wash(chosen.press, true)];

        expect(plain.hover.layers[0]?.alpha).toBeLessThan(rest);
        expect(rest).toBeLessThan(hover);
        expect(hover).toBeLessThan(press);
        expect(hover).toBe(scheme === "light" ? 0.07 : 0.13);

        // A selected row at press reaches the same wash as an unselected one.
        expect(press).toBe(wash(plain.press, false));

        if (kind === ".rail-row") {
          for (const read of [chosen.rest, chosen.hover, chosen.press]) {
            expect(read.backgroundColor).toBe("rgba(0, 0, 0, 0)");
          }
        }
      }, 60_000);
    }
  }
});

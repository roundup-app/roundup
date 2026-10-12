import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U385: adjacent items in a Rail row never touch. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U385 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const GAPS = `() => {
  for (const age of document.querySelectorAll(".rail-row .live-age")) age.textContent = "1061d";
  const out = { gaps: [], margins: [], columnGap: [], ages: [] };
  for (const line of document.querySelectorAll(".rail-row .line")) {
    // U426: the icon group overlays the row's right edge out of the flow, so it is no neighbour in the line.
    const kids = [...line.children].filter((child) => child.getBoundingClientRect().width > 0 && !child.classList.contains("rail-icons"));
    out.columnGap.push(getComputedStyle(line).columnGap);
    for (const kid of kids) out.margins.push(getComputedStyle(kid).marginLeft);
    for (let i = 1; i < kids.length; i++) out.gaps.push(kids[i].getBoundingClientRect().left - kids[i - 1].getBoundingClientRect().right);
    for (const age of line.querySelectorAll(".live-age")) out.ages.push({ text: age.textContent, tabular: getComputedStyle(age).fontVariantNumeric, whole: age.scrollWidth <= age.clientWidth });
  }
  return out;
}`;

type Gaps = { gaps: number[]; margins: string[]; columnGap: string[]; ages: { text: string; tabular: string; whole: boolean }[] };

run("u385 adjacent items in a Rail row never touch", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const [width, height] of [[1280, 800], [700, 800]] as const) {
    it(`u385_adjacent_children_are_at_least_space_1_apart at ${width}x${height}`, async () => {
      await page.load("/harness.html?seed=thread-report", width, height);
      await page.until(`() => Boolean(window.__fake) && document.querySelector(".rail-row .line") !== null`);
      await page.call(`() => document.querySelector('.rail-row[aria-expanded]').click()`);
      await page.until(`() => document.querySelector('.rail-row[aria-expanded][data-selected="true"]') !== null`);
      const read = await page.call<Gaps>(GAPS);

      expect(read.gaps.length).toBeGreaterThan(0);
      expect(Math.min(...read.gaps)).toBeGreaterThanOrEqual(4);
      expect(read.columnGap.every((gap) => gap === "4px" || gap === "8px")).toBe(true);
      expect(read.margins.every((margin) => margin === "0px")).toBe(true);

      for (const age of read.ages) {
        expect(age.text).toBe("1061d");
        expect(age.tabular).toContain("tabular-nums");
        expect(age.whole).toBe(true);
      }
    });
  }
});

describe("u385 one rule", () => {
  it("u385_no_line_child_sets_margin_left", () => {
    for (const file of ["rail/styles.css", "ink/styles.css"]) {
      const css = readFileSync(resolve(process.cwd(), "src", file), "utf8");
      const rules = [...css.matchAll(/([^{}]*\.rail-row[^{}]*\.line\s*>[^{}]*)\{([^}]*)\}/g)];

      for (const [, , body] of rules) expect(body).not.toMatch(/margin-left/);
    }
  });
});

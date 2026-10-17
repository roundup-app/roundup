import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U385: adjacent items in a Rail row never touch; the Rail draws no age (U404), so the pairs are the chevron, name, Door Glyph and right side. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const GAPS = `() => {
  const out = { gaps: [], margins: [], columnGap: [] };
  for (const line of document.querySelectorAll(".rail-row .line")) {
    // U426: hidden icons are out of flow; their internal zero gaps are measured separately.
    const kids = [...line.children].filter((child) => !child.classList.contains("row-icons") && child.getBoundingClientRect().width > 0);
    out.columnGap.push(getComputedStyle(line).columnGap);
    for (const kid of kids) out.margins.push(getComputedStyle(kid).marginLeft);
    for (let i = 1; i < kids.length; i++) out.gaps.push(kids[i].getBoundingClientRect().left - kids[i - 1].getBoundingClientRect().right);
  }
  return out;
}`;

type Gaps = { gaps: number[]; margins: string[]; columnGap: string[] };

run("u385 adjacent items in a Rail row never touch", () => {
  beforeAll(async () => {
    if (!found) throw new Error("U385 needs a Chrome binary: set CHROME_PATH");

    page = await openPage(found);
  }, 90_000);

  afterAll(async () => {
    await page?.close();
  });

  vi.setConfig({ testTimeout: 30_000 });

  for (const [width, height] of [[1280, 800]] as const) {
    it(`u385_adjacent_children_are_at_least_space_1_apart at ${width}x${height}`, async () => {
      await page.load("/harness.html?seed=door-report", width, height);
      await page.until(`() => Boolean(window.__fake) && document.querySelector(".rail-row .line") !== null`);
      await page.call(`() => document.querySelector('[data-part=branch-control].rail-row').click()`);
      await page.until(`() => document.querySelector('[data-part=branch-control].rail-row[data-selected="true"]') !== null`);
      const read = await page.call<Gaps>(GAPS);

      expect(read.gaps.length).toBeGreaterThan(0);
      expect(Math.min(...read.gaps)).toBeGreaterThanOrEqual(4);
      expect(read.columnGap.every((gap) => gap === "4px" || gap === "8px")).toBe(true);
      expect(read.margins.filter((margin) => margin !== "0px")).toEqual([]);
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

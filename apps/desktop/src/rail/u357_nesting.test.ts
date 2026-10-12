import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U357 in a real Chromium: jsdom has no layout, so every row of `tree-40` is read by its rendered boxes. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U357");

beforeAll(async () => {
  if (!found) throw new Error("U357 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Box = { left: number; right: number; top: number; bottom: number };

type Measured = {
  rows: {
    id: string;
    depth: number;
    glyph: Box;
    name: Box;
    description: Box | null;
    branches: { box: Box; image: string; borders: string[]; size: string }[];
    last: boolean;
    rowBottom: number;
    parent: { glyph: Box; name: Box } | null;
    mid: number;
  }[];
  adds: { depth: number; plus: Box; column: number | null }[];
  overflow: boolean;
  step: number;
};

const MEASURE = `() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const leadOf = (row) => row.querySelector(":scope > .line > .badge, :scope > .line > .glyph");
  const items = [...document.querySelectorAll('[role="treeitem"][data-id]')];
  // Siblings run on past a row while a later row, or its "done" fold, sits at its depth; the add line ends them.
  const all = [...document.querySelectorAll('[role="treeitem"][data-id], .rail-fold [role="treeitem"]')];
  const stack = [];
  const rows = items.map((row) => {
    const depth = Number(row.getAttribute("aria-level")) - 1;
    stack.length = depth;
    const parentRow = depth > 0 ? stack[depth - 1] : null;
    stack[depth] = row;
    const glyph = box(leadOf(row));
    const name = box(row.querySelector(".name"));
    const description = row.querySelector(".description");
    const r = row.getBoundingClientRect();
    const later = all.slice(all.indexOf(row) + 1).map((el) => Number(el.getAttribute("aria-level")) - 1).find((d) => d <= depth);
    return {
      last: later === undefined || later < depth, rowBottom: r.bottom,
      id: row.getAttribute("data-id"), depth, glyph, name,
      description: description ? box(description) : null,
      branches: [...row.querySelectorAll(":scope > .rail-branch")].map((el) => {
        const style = getComputedStyle(el);
        return { box: box(el), image: style.backgroundImage, borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], size: style.backgroundSize };
      }),
      parent: parentRow ? { glyph: box(leadOf(parentRow)), name: box(parentRow.querySelector(".name")) } : null,
      mid: (r.top + r.bottom) / 2,
    };
  });
  const adds = [...document.querySelectorAll(".rail-adds")].map((line) => {
    const level = Number(line.querySelector("[role=treeitem]").getAttribute("aria-level"));
    const same = rows.filter((row) => row.depth === level - 1).at(-1);
    return { depth: level - 1, plus: box(line.querySelector("button .icon, button svg")), column: same ? same.glyph.left : null };
  });
  const tree = document.querySelector(".rail-tree");
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:var(--rail-step)";
  tree.appendChild(probe);
  const step = probe.getBoundingClientRect().width;
  probe.remove();
  return { rows, adds, overflow: tree.scrollWidth > tree.clientWidth, step };
}`;

run("u357 a nested row shows its nesting", () => {
  vi.setConfig({ testTimeout: 90_000 });

  for (const scheme of ["light", "dark"] as const) {
    for (const [width, height] of [[1280, 800], [700, 800]] as const) {
      it(`u357_a_child_glyph_sits_under_its_parents_name_with_a_dashed_connector at ${width}x${height} ${scheme}`, async () => {
        await page.scheme(scheme);
        await page.load("/harness.html?seed=tree-40", width, height);
        await page.until(`() => document.querySelectorAll('[role="treeitem"][data-id]').length > 20`, 60_000);

        await page.call(`() => document.querySelector('[data-id="backend"]').click()`);
        await page.until(`() => Boolean(document.querySelector(".rail-adds"))`);

        const seen = await page.call<Measured>(MEASURE);

        expect(new Set(seen.rows.map((row) => row.depth)).size, "tree-40 holds Workstream, nested and Agent depths").toBeGreaterThanOrEqual(3);
        expect(seen.step).toBe(28);
        expect(seen.overflow, "no horizontal scroll").toBe(false);

        for (const row of seen.rows) {
          if (row.parent === null) {
            expect(row.branches, `${row.id} is a root`).toHaveLength(0);
          } else {
            // Step: the child's glyph is under the parent's name.
            expect(Math.abs(row.glyph.left - row.parent.name.left), `${row.id} glyph against its parent's name`).toBeLessThanOrEqual(1);
            expect(row.glyph.left - row.parent.glyph.left, `${row.id} steps one glyph and its gap`).toBeCloseTo(seen.step, 0);

            // Connector: one dashed background from the parent's glyph to this glyph, no border.
            expect(row.branches, `${row.id} connector`).toHaveLength(1);
            const [branch] = row.branches;
            expect(branch!.image).toContain("repeating-linear-gradient");
            expect(branch!.borders).toEqual(["0px", "0px", "0px", "0px"]);
            const parentCentre = (row.parent.glyph.left + row.parent.glyph.right) / 2;
            expect(Math.abs(branch!.box.left - parentCentre), `${row.id} connector starts at the parent's glyph`).toBeLessThanOrEqual(1);
            expect(Math.abs(branch!.box.right - row.glyph.left), `${row.id} connector ends at the glyph`).toBeLessThanOrEqual(1);
            // Last child: the vertical dash stops at the row's middle; any other child's runs on to the row's bottom, to its next sibling.
            expect(branch!.size.split(",")[0]!.trim(), `${row.id} vertical dash extent`).toBe(row.last ? "1px 50%" : "1px 100%");
            expect(Math.abs(branch!.box.bottom - row.rowBottom), `${row.id} connector box reaches the row's bottom`).toBeLessThanOrEqual(1);
            expect(branch!.box.top).toBeLessThanOrEqual(row.mid);
            expect(branch!.box.bottom).toBeGreaterThanOrEqual(row.mid);
            expect(branch!.box.right, `${row.id} connector clear of its label`).toBeLessThanOrEqual(row.name.left);
          }

          // Description: the line starts at the name.
          if (row.description) expect(Math.abs(row.description.left - row.name.left), `${row.id} description`).toBeLessThanOrEqual(1);
        }

        // Add line: the `+` sits in its siblings' glyph column.
        for (const add of seen.adds) {
          if (add.column !== null) expect(Math.abs(add.plus.left - add.column), "add line column").toBeLessThanOrEqual(1);
        }

        expect(seen.adds.length, "tree-40 shows an add line").toBeGreaterThan(0);

        mkdirSync(ART, { recursive: true });
        writeFileSync(join(ART, `rail-${width}x${height}-${scheme}.png`), Buffer.from(await page.shot(), "base64"));
      });
    }
  }
});

describe("u357 the step is a Token", () => {
  const dir = resolve(__dirname);
  const sources = readdirSync(dir).filter((name) => /\.(css|tsx?)$/.test(name) && !name.includes(".test."));

  it("u357_the_step_is_a_token_and_no_rail_source_indents_in_ch", () => {
    for (const name of sources) expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/\d\s*ch\b/);

    const css = readFileSync(join(dir, "styles.css"), "utf8");
    const row = readFileSync(join(dir, "RailRow.tsx"), "utf8");

    expect(css).toMatch(/--rail-step:\s*calc\(var\(--space-5\) \+ var\(--space-1\)\)/);
    expect(row).toContain("var(--rail-step)");
  });
});

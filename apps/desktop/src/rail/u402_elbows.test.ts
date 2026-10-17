import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

/** U402 in a real Chromium: jsdom has no layout, so every row of `tree-40` and `agents-10` is read by its rendered boxes. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = captureDir("U402");

type Box = { left: number; right: number; top: number; bottom: number };

type Trunk = { box: Box; image: string; borders: string[]; size: string };

type Measured = {
  rows: {
    id: string;
    depth: number;
    mark: Box;
    name: Box;
    last: boolean;
    selected: boolean;
    bar: string;
    rowBox: Box;
    mid: number;
    branches: Trunk[];
    passes: Trunk[];
    stems: Trunk[];
    parent: { mark: Box } | null;
    ancestorsRunning: boolean[];
  }[];
  overflow: boolean;
  step: number;
  inset: number;
};

const MEASURE = `() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const markOf = (row) => row.querySelector(":scope > .line > .rail-chevron .icon") ?? row.querySelector(":scope > .line > .glyph");
  const trunk = (el) => { const style = getComputedStyle(el); return { box: box(el), image: style.backgroundImage, borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], size: style.backgroundSize }; };
  const items = [...document.querySelectorAll('[role="treeitem"][data-id]')];
  const all = [...document.querySelectorAll('[role="treeitem"][data-id], .rail-fold [role="treeitem"]')];
  const rowOf = (item) => item.matches('[data-part="branch"]') ? item.querySelector(':scope > [data-part="branch-control"]') : item;
  const stack = [];
  const lastOf = (row) => { const depth = Number(row.getAttribute("aria-level")) - 1; const later = all.slice(all.indexOf(row) + 1).map((el) => Number(el.getAttribute("aria-level")) - 1).find((d) => d <= depth); return later === undefined || later < depth; };
  const rows = items.map((item) => {
    const row = rowOf(item);
    const depth = Number(item.getAttribute("aria-level")) - 1;
    stack.length = depth;
    const parentRow = depth > 0 ? stack[depth - 1] : null;
    stack[depth] = row;
    const r = row.getBoundingClientRect();
    return {
      id: row.getAttribute("data-id"), depth, mark: box(markOf(row)), name: box(row.querySelector(".name")),
      last: lastOf(item), selected: item.getAttribute("aria-selected") === "true", bar: getComputedStyle(row).backgroundSize, rowBox: box(row), mid: (r.top + r.bottom) / 2,
      branches: [...row.querySelectorAll(":scope > .rail-branch")].map(trunk),
      passes: [...row.querySelectorAll(":scope > .rail-pass")].map(trunk),
      stems: [...row.querySelectorAll(":scope > .rail-stem")].map(trunk),
      parent: parentRow ? { mark: box(markOf(parentRow)) } : null,
      ancestorsRunning: stack.slice(1, depth).map((ancestor) => !lastOf(items.find((each) => rowOf(each) === ancestor))),
    };
  });
  const tree = document.querySelector(".rail-tree");
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:var(--rail-step)";
  tree.appendChild(probe);
  const step = probe.getBoundingClientRect().width;
  probe.style.width = "var(--rail-inset)";
  const inset = probe.getBoundingClientRect().width;
  probe.remove();
  return { rows, overflow: tree.scrollWidth > tree.clientWidth, step, inset };
}`;

const seen = new Map<string, Promise<Measured>>();

type Config = { scheme: "light" | "dark"; width: number; height: number };

const CONFIGS: Config[] = [
  { scheme: "light", width: 1280, height: 800 },
  { scheme: "dark", width: 1280, height: 800 },
];

/** One load per viewport, scheme and seed, shared by every case below. */
const measure = (seed: string, config: Config) => {
  const key = `${seed} ${config.scheme} ${config.width}`;

  if (!seen.has(key))
    seen.set(
      key,
      (async () => {
        await page.scheme(config.scheme);
        await page.load(`/harness.html?seed=${seed}`, config.width, config.height);
        await page.until(`() => document.querySelectorAll('[role="treeitem"][data-id]').length > 8`, 60_000);

        if (seed === "tree-40") {
          await page.call(`() => document.querySelector('.rail-row[data-id="backend"]').click()`);
          await page.until(`() => document.querySelector('.rail-row[data-id="backend"]')?.getAttribute("data-selected") === "true"`);
        }

        const read = await page.call<Measured>(MEASURE);

        if (ART) {
          mkdirSync(ART, { recursive: true });
          writeFileSync(join(ART, `${seed}-${config.width}x${config.height}-${config.scheme}.png`), Buffer.from(await page.shot(), "base64"));
        }

        return read;
      })(),
    );

  return seen.get(key)!;
};

const each = async (check: (read: Measured, label: string) => void) => {
  for (const seed of ["tree-40", "agents-10"])
    for (const config of CONFIGS) check(await measure(seed, config), `${seed} ${config.scheme} ${config.width}x${config.height}`);
};

/** A trunk's x is the centre of a 16 px mark at `level`. */
const trunkX = (read: Measured, level: number) => 16 + level * read.step + read.inset + 8;

run("u402 the tree is drawn with elbows", () => {
  beforeAll(async () => {
    if (!found) throw new Error("U402 needs a Chrome binary: set CHROME_PATH");

    page = await openPage(found);
  }, 90_000);

  afterAll(async () => {
    await page?.close();
  });

  vi.setConfig({ testTimeout: 180_000 });

  it("u402_a_trunk_drops_from_the_parent_mark", () =>
    each((read, label) => {
      expect(read.rows.some((row) => row.depth > 0) || label.startsWith("agents-10"), label).toBe(true);

      for (const row of read.rows) {
        if (row.parent === null) {
          expect(row.branches, `${label} ${row.id} is a root`).toHaveLength(0);
          continue;
        }

        expect(row.branches, `${label} ${row.id} branch`).toHaveLength(1);
        const [branch] = row.branches;
        const parentCentre = (row.parent.mark.left + row.parent.mark.right) / 2;

        expect(branch!.image, row.id).toContain("repeating-linear-gradient");
        expect(branch!.borders, `${row.id} draws no border`).toEqual(["0px", "0px", "0px", "0px"]);
        expect(Math.abs(branch!.box.left - parentCentre), `${label} ${row.id} trunk starts at the parent's mark`).toBeLessThanOrEqual(1);
        expect(branch!.box.right, `${label} ${row.id} trunk clear of its name`).toBeLessThanOrEqual(row.name.left);
      }
    }));

  it("u402_the_last_child_ends_its_trunk_at_the_elbow", () =>
    each((read, label) => {
      for (const row of read.rows.filter((each) => each.parent !== null)) {
        const [branch] = row.branches;
        const vertical = branch!.size.split(",")[0]!.trim();

        expect(Math.abs(branch!.box.right - row.mark.left), `${label} ${row.id} elbow reaches the Glyph`).toBeLessThanOrEqual(1);
        expect(branch!.box.top).toBeLessThanOrEqual(row.mid);
        expect(branch!.box.bottom).toBeGreaterThanOrEqual(row.mid);

        if (row.last) expect(vertical, `${label} ${row.id} stops at its elbow`).toMatch(/^1px (1[0-9]|2[0-4])px$/);
        else expect(vertical, `${label} ${row.id} runs on`).toBe("1px 100%");
      }
    }));

  it("u402_a_trunk_runs_past_deeper_rows", () =>
    each((read, label) => {
      for (const row of read.rows) {
        const levels = row.ancestorsRunning.flatMap((runs, at) => (runs ? at : []));

        expect(row.passes, `${label} ${row.id} passes`).toHaveLength(levels.length);

        for (const pass of row.passes) {
          expect(pass.image, row.id).toContain("repeating-linear-gradient");
          expect(pass.box.top, row.id).toBeLessThanOrEqual(row.mid);
          expect(pass.box.bottom, row.id).toBeGreaterThanOrEqual(row.mid);
          expect(levels.some((level) => Math.abs(pass.box.left - row.rowBox.left - trunkX(read, level)) <= 1), `${label} ${row.id} pass at ${pass.box.left} want ${levels.map((l) => trunkX(read, l))} step ${read.step} inset ${read.inset}`).toBe(true);
        }
      }
    }));

  it("u402_every_depth_steps_by_the_rail_step", () =>
    each((read, label) => {
      expect(read.step, label).toBe(28);
      expect(read.overflow, `${label} no horizontal scroll`).toBe(false);

      if (label.startsWith("tree-40")) expect(new Set(read.rows.map((row) => row.depth)).size, label).toBeGreaterThanOrEqual(2);

      for (const row of read.rows.filter((each) => each.parent !== null)) expect(row.mark.left - row.parent!.mark.left, `${label} ${row.id} steps one --rail-step`).toBeCloseTo(read.step, 0);

    }));

  it("u402_the_selection_bar_clears_the_trunk", () =>
    each((read, label) => {
      const selected = read.rows.filter((row) => row.selected);

      for (const row of selected) {
        expect(row.bar.split(",")[0]!.trim(), `${label} ${row.id} bar`).toBe("2px 100%");

        for (const trunk of [...row.branches, ...row.passes, ...row.stems]) expect(trunk.box.left - row.rowBox.left, `${label} ${row.id} trunk clear of the bar`).toBeGreaterThanOrEqual(read.inset);
      }
    }));
});

describe("u402 the step is a Token", () => {
  const dir = resolve(__dirname);
  const sources = readdirSync(dir).filter((name) => /\.(css|tsx?)$/.test(name) && !name.includes(".test."));

  it("u402_the_step_is_a_token_and_no_rail_source_indents_in_ch", () => {
    for (const name of sources) expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/\d\s*ch\b/);

    const css = readFileSync(join(dir, "styles.css"), "utf8");
    const row = readFileSync(join(dir, "RailRow.tsx"), "utf8");

    expect(css).toMatch(/--rail-step:\s*calc\(var\(--space-5\) \+ var\(--space-1\)\)/);
    expect(row).toContain("var(--rail-step)");
  });
});

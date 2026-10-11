import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U359 in a real Chromium: jsdom has no layout, so the Shelf's left edges, lines and gaps are read from the rendered `todos` and `pads` lists. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U359 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

type Row = { list: string; glyph: number; title: number; lines: number[]; height: number; top: number; bottom: number; width: number; listWidth: number; mono: number; background: string; border: string; shadow: string; radius: string; family: string; titleLines: number };

/** Page-side: every row of the `todos` and `pads` lists with the x of its Glyph, title and each later line, and its box. */
const READ = `() => ["todos", "pads"].flatMap((list) => [...document.querySelectorAll('.shelf section[aria-label="' + list + '"] .shelf-row')].map((row) => {
  const box = row.getBoundingClientRect();
  const title = row.querySelector(".shelf-title");
  const style = getComputedStyle(row);
  const titleStyle = getComputedStyle(title);
  const lineHeight = parseFloat(titleStyle.lineHeight) || parseFloat(titleStyle.fontSize) * 1.2;
  return {
    list,
    glyph: row.querySelector(".shelf-glyph > *").getBoundingClientRect().left,
    title: title.getBoundingClientRect().left,
    lines: [...row.querySelector(".shelf-text").children].slice(1).map((line) => line.getBoundingClientRect().left),
    height: box.height, top: box.top, bottom: box.bottom, width: box.width,
    listWidth: row.parentElement.getBoundingClientRect().width,
    mono: [...row.querySelectorAll("*")].filter((el) => !el.closest("[data-mono]") && getComputedStyle(el).fontFamily.includes("Mono") && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).length,
    background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow, radius: style.borderTopLeftRadius, family: titleStyle.fontFamily,
    titleLines: Math.round(title.getBoundingClientRect().height / lineHeight),
  };
}))`;

const SEEDS = ["tree-40", "agents-10", "first-run"] as const;

/** Page-side: adds the worst-case Todos and Pad (a 300-character title, ten open blockers, a long Workstream Home, a 120-character Pad name) through the fake Daemon, then waits for the rows. */
const WORST = `async () => {
  const app = window.__fake.app;
  const first = await app.rpc("todo.create", { title: "w".repeat(300), body: null, blockers: null });
  const blockers = [];
  for (let n = 0; n < 10; n++) blockers.push((await app.rpc("todo.create", { title: "blocker " + n, body: null, blockers: null })).id);
  await app.rpc("todo.create", { title: "blocked by ten", body: null, blockers });
  await app.rpc("pad.create", { name: "p".repeat(120), text: null });
  await new Promise((done) => setTimeout(done, 400));
  return first.id;
}`;

run("u359 a Todo row and a Pad row are one designed row", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const seed of SEEDS)
    for (const scheme of ["light", "dark"] as const)
      for (const [width, height] of [[1280, 820], [700, 800]] as const) {
        it(`u359_each_list_has_one_glyph_edge_and_one_text_edge_and_lines_hang_under_the_title on ${seed} ${scheme} at ${width}x${height}`, async () => {
          await page.scheme(scheme);
          await page.load(`/harness.html?seed=${seed}`, width, height);
          await page.until(`() => document.body.textContent.length > 0 && Boolean(window.__fake)`);

          // The first-run screen has no project, so no Shelf: all three Checks pass with no row to measure.
          if (seed === "first-run") {
            const none = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

            for (const id of ["D12", "D13", "D14"]) expect(none[id], id).toMatchObject({ status: "pass" });

            return;
          }

          await page.until(`() => document.querySelector(".shelf") !== null`);
          await page.call(WORST);
          await page.until(`() => document.querySelectorAll('.shelf section[aria-label="pads"] .shelf-row').length > 0`);

          const rows = await page.call<Row[]>(READ);
          const edges = (key: "glyph" | "title") => rows.map((row) => row[key]);

          expect(rows.some((row) => row.list === "todos") && rows.some((row) => row.list === "pads")).toBe(true);

          for (const list of ["todos", "pads"]) {
            const own = rows.filter((row) => row.list === list);

            for (const key of ["glyph", "title"] as const) for (const row of own) expect(Math.abs(row[key] - own[0]![key]), `${list} ${key}`).toBeLessThanOrEqual(1);

            for (const row of own) {
              for (const line of row.lines) expect(Math.abs(line - row.title)).toBeLessThanOrEqual(1);

              expect(row.title - row.glyph).toBeGreaterThanOrEqual(23);
              expect(row.titleLines).toBeLessThanOrEqual(2);
              expect(row.width).toBeLessThanOrEqual(row.listWidth + 1);
              expect(row.background).toBe("rgba(0, 0, 0, 0)");
              expect([row.border, row.shadow, row.radius]).toEqual(["0px", "none", "0px"]);
              expect(row.mono, `${list} mono words`).toBe(0);
            }
          }

          // The two lists share one Glyph edge.
          expect(Math.abs(Math.min(...edges("glyph")) - Math.max(...edges("glyph")))).toBeLessThanOrEqual(1);

          const checks = await page.call<Record<string, { status: string; value: unknown }>>(`() => window.__checks()`);

          for (const id of ["D2", "D12", "D13", "D14"]) expect(checks[id], `${id} ${JSON.stringify(checks[id])}`).toMatchObject({ status: "pass" });
        });
      }
});

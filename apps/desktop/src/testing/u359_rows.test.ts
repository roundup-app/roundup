import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U359 in a real Chromium: jsdom has no layout, so the Shelf's left edges, lines and gaps are read from the rendered `todos` and `pads` lists. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U359");

/** The observer evidence of U360: each Check's result and the row boxes, per screen. */
const keep = (name: string, value: Readonly<Record<string, { status: string }>> | readonly Row[]) => {
  mkdirSync(ART, { recursive: true });
  writeFileSync(resolve(ART, name), `${JSON.stringify(value, null, 2)}\n`);
};

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

/** Page-side: adds the worst-case Todos and Pad (a 300-character title, ten open blockers, a Home that is a Workstream with a 60-character name, a 120-character Pad name) through the fake Daemon, then waits for the rows. */
const WORST = `async () => {
  const app = window.__fake.app;
  // U347: with no Workstream selected the Shelf lists only what a running Agent owns, so \`agent-1\` makes the worst case.
  window.__fake.actAs({ kind: "agent", id: "agent-1", parent: null });
  const first = await app.rpc("todo.create", { title: "w".repeat(300), body: null, blockers: null });
  const blockers = [];
  for (let n = 0; n < 10; n++) blockers.push((await app.rpc("todo.create", { title: "blocker " + n, body: null, blockers: null })).id);
  await app.rpc("todo.create", { title: "blocked by ten", body: null, blockers });
  const home = await app.rpc("rail.createWorkstream", { name: "h".repeat(60), parent: null });
  const homed = await app.rpc("todo.create", { title: "homed in a long workstream", body: null, blockers: null });
  await app.rpc("todo.move", { id: homed.id, home: home.id });
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

            keep(`${seed}-${scheme}-${width}x${height}.checks.json`, none);

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

          keep(`${seed}-${scheme}-${width}x${height}.checks.json`, checks);
          keep(`${seed}-${scheme}-${width}x${height}.rows.json`, rows);
        });
      }

  /** Loads a seed with the worst case added and runs `check` on it, for each scheme and width; the first-run screen has no Shelf. */
  const onEveryScreen = async (check: (label: string) => Promise<void>) => {
    for (const seed of ["tree-40", "agents-10"] as const)
      for (const scheme of ["light", "dark"] as const)
        for (const [width, height] of [[1280, 820], [700, 800]] as const) {
          await page.scheme(scheme);
          await page.load(`/harness.html?seed=${seed}`, width, height);
          await page.until(`() => Boolean(window.__fake) && document.querySelector(".shelf") !== null`);
          await page.call(WORST);
          await page.until(`() => document.querySelectorAll('.shelf section[aria-label="pads"] .shelf-row').length > 0`);
          await check(`${seed} ${scheme} ${width}x${height}`);
        }
  };

  const BUILD = `() => ["todos", "pads"].flatMap((list) => [...document.querySelectorAll('.shelf section[aria-label="' + list + '"] .shelf-row')].filter((row) => row.querySelector('[title]')).map((row) => {
    const style = getComputedStyle(row);
    const text = row.querySelector(".shelf-text");
    return { list, attr: row.hasAttribute("data-shelf-row"), kinds: [...row.classList].join(" "), display: style.display, columns: style.gridTemplateColumns.split(" ").length, gap: style.columnGap, padTop: style.paddingTop, padBottom: style.paddingBottom, glyph: row.querySelector(".shelf-glyph").getBoundingClientRect().width, parts: [...row.children].map((c) => c.className).join(), text: [...text.children].map((c) => c.className).join(), meta: (row.querySelector(".shelf-meta")?.textContent ?? "").replace(/\\s+/g, " ").trim() };
  }))`;

  type Build = { list: string; attr: boolean; kinds: string; display: string; columns: number; gap: string; padTop: string; padBottom: string; glyph: number; parts: string; text: string; meta: string };

  it("u359_a_todo_and_a_pad_share_one_row", async () => {
    await onEveryScreen(async (where) => {
      const rows = await page.call<Build[]>(BUILD);
      const todos = rows.filter((row) => row.list === "todos" && row.attr);
      const pads = rows.filter((row) => row.list === "pads");

      expect(todos.length && pads.length, where).toBeGreaterThan(0);

      const [one] = todos;

      for (const row of [...todos, ...pads]) {
        expect([row.kinds.split(" ")[0], row.display, row.columns, row.gap, row.padTop, row.padBottom, row.glyph, row.parts], where).toEqual(["shelf-row", "grid", 2, "8px", "4px", "4px", 16, "shelf-glyph,shelf-text"]);
        expect(one && row.display === one.display, where).toBe(true);
      }

      for (const row of todos) expect(row.meta, where).toMatch(/^#\d+( waits on #\d+(, #\d+)*)? in \S+/);

      for (const row of pads.filter((pad) => pad.meta !== "")) expect(row.meta, where).toMatch(/^owned by /);

      expect(todos.some((row) => /^#\d+ waits on (#\d+, ){9}#\d+ in /.test(row.meta)), where).toBe(true);
      expect(todos.some((row) => row.meta.endsWith(`in ${"h".repeat(60)}`)), where).toBe(true);
    });
  }, 120_000);

  const FILL = `(x, y) => { const row = document.elementFromPoint(x, y)?.closest(".shelf-row"); if (!row) return null; const style = getComputedStyle(row); return { background: style.backgroundColor, image: style.backgroundImage, border: style.borderTopWidth + style.borderLeftWidth, shadow: style.boxShadow, radius: style.borderTopLeftRadius }; }`;

  it("u359_no_row_is_a_card", async () => {
    await onEveryScreen(async (where) => {
      const rows = await page.call<Row[]>(READ);

      for (const row of rows) expect([row.background, row.border, row.shadow, row.radius], `${where} ${row.list}`).toEqual(["rgba(0, 0, 0, 0)", "0px", "none", "0px"]);

      // On hover the wash is a background-image and the row stays without a fill, a border or a shadow.
      for (const list of ["todos", "pads"]) {
        const at = await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('.shelf section[aria-label="${list}"] .shelf-row'); r.scrollIntoView({ block: "center" }); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 4 }; }`);

        await page.hover(at.x, at.y);

        const state = await page.call<{ background: string; image: string; border: string; shadow: string } | null>(FILL, at.x, at.y);

        expect(state, `${where} ${list}`).not.toBeNull();
        expect([state?.background, state?.border, state?.shadow], `${where} ${list} hover`).toEqual(["rgba(0, 0, 0, 0)", "0px0px", "none"]);
        expect(state?.image, `${where} ${list} hover wash`).toContain("gradient");
      }
    });
  }, 120_000);

  it("u359_lines_after_the_first_hang_under_the_title", async () => {
    await onEveryScreen(async (where) => {
      const rows = await page.call<Row[]>(READ);
      const wrapped = rows.filter((row) => row.titleLines === 2);

      // The 300-character title and the 120-character Pad name wrap to a second line; the meta line follows.
      expect(new Set(wrapped.map((row) => row.list)), where).toEqual(new Set(["todos", "pads"]));

      for (const row of rows) {
        expect(row.lines.length, where).toBeGreaterThanOrEqual(0);

        for (const line of row.lines) expect(Math.abs(line - row.title), where).toBeLessThanOrEqual(1);

        expect(row.title - row.glyph, where).toBeGreaterThanOrEqual(23);
      }

      const lines = await page.call<{ title: number; first: number; second: number }[]>(`() => [...document.querySelectorAll(".shelf-title")].filter((t) => t.getBoundingClientRect().height > 20).map((t) => { const r = document.createRange(); r.selectNodeContents(t); const boxes = [...r.getClientRects()]; return { title: t.getBoundingClientRect().left, first: boxes[0].left, second: boxes.at(-1).left }; })`);

      expect(lines.length, where).toBeGreaterThan(0);

      for (const line of lines) expect(Math.abs(line.second - line.title), where).toBeLessThanOrEqual(1);
    });
  }, 120_000);

  const RHYTHM = `() => {
    const lists = ["todos", "pads"].map((list) => {
      const section = document.querySelector('.shelf section[aria-label="' + list + '"]');
      const head = section.querySelector(".group-head").getBoundingClientRect();
      const mark = section.querySelector(".group-toggle svg, .group-toggle > *").getBoundingClientRect();
      const rows = [...section.querySelectorAll(".shelf-row")].map((r) => r.getBoundingClientRect());
      const glyph = section.querySelector(".shelf-row .shelf-glyph > *").getBoundingClientRect();
      return { list, headBottom: head.bottom, mark: mark.left, glyph: glyph.left, top: section.getBoundingClientRect().top, bottom: section.getBoundingClientRect().bottom, first: rows[0].top, heights: rows.map((r) => r.height), gaps: rows.slice(1).map((r, at) => r.top - rows[at].bottom) };
    });
    return { lists, bad: [...document.querySelectorAll(".shelf *")].map((el) => getComputedStyle(el)).flatMap((s) => [s.marginTop, s.marginBottom, s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight, s.rowGap]).filter((v) => v !== "normal" && ![0, 4, 8, 12, 16, 24, 32].includes(parseFloat(v))) };
  }`;

  it("u359_the_gaps_are_space_steps_and_the_same_in_both_lists", async () => {
    await onEveryScreen(async (where) => {
      const { lists, bad } = await page.call<{ lists: { list: string; headBottom: number; mark: number; glyph: number; top: number; bottom: number; first: number; heights: number[]; gaps: number[] }[]; bad: string[] }>(RHYTHM);
      const todos = lists.find((own) => own.list === "todos");
      const pads = lists.find((own) => own.list === "pads");

      if (!todos || !pads) throw new Error(`${where}: a list is missing`);

      expect(bad, where).toEqual([]);

      for (const own of lists) {
        for (const height of own.heights) expect(height, `${where} ${own.list}`).toBeGreaterThanOrEqual(28);

        for (const gap of own.gaps) expect(Math.abs(gap), `${where} ${own.list} gap`).toBeLessThanOrEqual(0.5);

        expect(own.first - own.headBottom, `${where} ${own.list} head to first row`).toBeCloseTo(4, 0);
        // The head's mark and the Glyph share one x.
        expect(Math.abs(own.mark - own.glyph), `${where} ${own.list} mark`).toBeLessThanOrEqual(1);
      }

      expect(pads.top - todos.bottom, `${where} between the lists`).toBeCloseTo(12, 0);
      expect(Math.abs(todos.first - todos.headBottom - (pads.first - pads.headBottom)), where).toBeLessThanOrEqual(0.5);
      expect(Math.abs(todos.glyph - pads.glyph), where).toBeLessThanOrEqual(1);
    });
  }, 120_000);

  it("u359_words_that_are_not_ids_or_paths_use_the_ui_font", async () => {
    await onEveryScreen(async (where) => {
      const rows = await page.call<Row[]>(READ);

      for (const row of rows) expect(row.mono, `${where} ${row.list} mono words`).toBe(0);

      const type = await page.call<{ title: string; body: string; text: string; meta: string; caption: string; grey: string; idFamily: string }>(`() => {
        const root = getComputedStyle(document.documentElement);
        const title = getComputedStyle(document.querySelector(".shelf-title"));
        const meta = getComputedStyle(document.querySelector('.shelf section[aria-label="todos"] .shelf-meta'));
        const id = document.querySelector('.shelf section[aria-label="todos"] .shelf-meta [data-mono]');
        const probe = (v) => { const p = document.createElement("i"); p.style.color = "var(" + v + ")"; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
        return { title: title.fontFamily + "|" + title.fontSize, body: root.getPropertyValue("--text-body").trim(), text: title.color + "=" + probe("--text"), meta: meta.fontFamily + "|" + meta.fontSize, caption: root.getPropertyValue("--text-caption").trim(), grey: meta.color + "=" + probe("--grey"), idFamily: getComputedStyle(id).fontFamily };
      }`);

      const same = (pair: string) => expect(pair.split("=")[0], where).toBe(pair.split("=")[1]);

      expect(type.title, where).not.toContain("Mono");
      expect(type.title.split("|")[1], where).toBe(type.body);
      expect(type.meta.split("|")[0], where).not.toContain("Mono");
      expect(type.meta.split("|")[1], where).toBe(type.caption);
      expect(type.idFamily, where).toContain("Mono");
      same(type.text);
      same(type.grey);
    });
  }, 120_000);

  const ENDINGS = `() => ["todos", "pads"].flatMap((list) => [...document.querySelectorAll('.shelf section[aria-label="' + list + '"] .shelf-row')].filter((row) => row.querySelector('[title]')).map((row) => {
    const title = row.querySelector(".shelf-title");
    const meta = row.querySelector(".shelf-meta");
    const style = getComputedStyle(title);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const box = row.getBoundingClientRect();
    return { list, text: title.textContent, attr: title.closest("[title]")?.getAttribute("title") ?? null, clamp: style.webkitLineClamp, overflow: style.overflow, cut: title.scrollHeight > title.clientHeight + 1, lines: Math.round(title.getBoundingClientRect().height / lineHeight), metaWrap: meta ? getComputedStyle(meta).whiteSpace + "|" + getComputedStyle(meta).textOverflow + "|" + getComputedStyle(meta).overflow : null, metaOne: meta ? meta.getBoundingClientRect().height < parseFloat(getComputedStyle(meta).fontSize) * 2.5 : true, wide: box.width > row.parentElement.getBoundingClientRect().width + 1 };
  }))`;

  type Ending = { list: string; text: string; attr: string | null; clamp: string; overflow: string; cut: boolean; lines: number; metaWrap: string | null; metaOne: boolean; wide: boolean };

  it("u359_a_long_title_and_a_long_pad_name_end_the_same_way", async () => {
    await onEveryScreen(async (where) => {
      const rows = await page.call<Ending[]>(ENDINGS);

      for (const row of rows) {
        expect([row.clamp, row.overflow], `${where} ${row.list}`).toEqual(["2", "hidden"]);
        expect(row.lines, where).toBeLessThanOrEqual(2);
        expect(row.wide, where).toBe(false);
        expect(row.metaOne, where).toBe(true);

        if (row.metaWrap !== null) expect(row.metaWrap, where).toBe("nowrap|ellipsis|hidden");

        // The full text is the row's title attribute.
        expect(row.attr, where).toBe(row.text);
      }

      const cut = new Set(rows.filter((row) => row.cut).map((row) => row.list));

      expect(cut, `${where} the long title and the long Pad name are both cut`).toEqual(new Set(["todos", "pads"]));
      expect(rows.some((row) => row.list === "todos" && row.text.length === 300), where).toBe(true);
      expect(rows.some((row) => row.list === "pads" && row.text.length === 120), where).toBe(true);

      // A hover or focus changes no row's top edge, height or wrapping.
      const before = await page.call<number[][]>(`() => [...document.querySelectorAll(".shelf-row")].map((r) => { const b = r.getBoundingClientRect(); return [b.top, b.height, r.querySelector(".shelf-title").getBoundingClientRect().height]; })`);
      const at = await page.call<{ x: number; y: number }>(`() => { const b = document.querySelector('.shelf section[aria-label="todos"] .shelf-row').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 4 }; }`);

      await page.hover(at.x, at.y);
      await page.call(`() => { document.querySelector('.shelf section[aria-label="todos"] .shelf-row button')?.focus(); }`);

      const after = await page.call<number[][]>(`() => [...document.querySelectorAll(".shelf-row")].map((r) => { const b = r.getBoundingClientRect(); return [b.top, b.height, r.querySelector(".shelf-title").getBoundingClientRect().height]; })`);

      expect(after, `${where} hover and focus`).toEqual(before);
    });
  }, 120_000);
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U389 to U391 in a real Chromium: jsdom has no layout, so widths, the footer and the Edge's hit area are read from the rendered window. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U389 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

// Widths persist per Project: a test that drags must not leave its width for the next.
afterEach(async () => {
  await page.call(`() => localStorage.clear()`);
});

afterAll(async () => {
  await page?.close();
});

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=tree-40", width, height);
  await page.until(`() => Boolean(document.querySelector(".rail-actions button"))`);
};

// Real pointer input: Ark's Splitter ignores synthetic events that carry no active pointer. The drag moves the edge by `to - from`.
const dragEdge = async (label: string, panel: string, from: number, to: number): Promise<number> => {
  const at = await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('[aria-label="${label}"]').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: 200 }; }`);

  await page.down(at.x, at.y);
  await page.pointer("move", at.x + (to - from) / 2, at.y);
  await page.pointer("move", at.x + (to - from), at.y);
  await page.release(at.x + (to - from), at.y);
  await page.call(`() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);

  return page.call<number>(`() => document.querySelector("${panel}").getBoundingClientRect().width`);
};

const railDrag = (from: number, to: number) => dragEdge("Resize Rail", ".rail", from, to);

const shelfDrag = (from: number, to: number) => dragEdge("Resize work items", ".shelf", from, to);


const GEOMETRY = `() => {
  const rail = document.querySelector(".rail").getBoundingClientRect();
  const footer = document.querySelector(".rail-actions").getBoundingClientRect();
  const button = document.querySelector(".rail-actions button").getBoundingClientRect();
  const centre = document.querySelector(".centre").getBoundingClientRect();
  const scroll = document.querySelector(".rail-scroll");
  const edge = document.querySelector('[aria-label="Resize Rail"]').getBoundingClientRect();
  return { rail: rail.width, railRight: rail.right, centre: centre.width, footerBottom: footer.bottom - rail.bottom, footerInWindow: window.innerHeight - footer.bottom, footerLeft: footer.left - rail.left, footerRight: rail.right - footer.right, buttonHeight: button.height, buttonWidth: button.width, scrollBottom: scroll.getBoundingClientRect().bottom - footer.top, edgeWidth: edge.width, edgeMid: (edge.left + edge.right) / 2 };
}`;

type Geometry = { rail: number; railRight: number; centre: number; footerBottom: number; footerInWindow: number; footerLeft: number; footerRight: number; buttonHeight: number; buttonWidth: number; scrollBottom: number; edgeWidth: number; edgeMid: number };

run("u389 to u391 in the rendered page", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u389_default_is_288_at_supported_heights", async () => {
    await load(1280, 800);
    expect((await page.call<Geometry>(GEOMETRY)).rail).toBe(288);
    await load(1280, 400);

    const short = await page.call<Geometry>(GEOMETRY);

    expect([short.rail, short.centre]).toEqual([288, 672]);
  });

  it("u389_a_drag_sets_the_width_and_clamps", async () => {
    await load(1280, 800);
    expect(await railDrag(288, 360)).toBe(360);
    expect(await railDrag(360, 900)).toBe(480);
    expect(await railDrag(480, 10)).toBe(252);
  });

  it("u389_the_maximum_is_480_at_1280", async () => {
    await load(1280, 800);
    expect(await railDrag(288, 900)).toBe(480);
  });

  it("u389_the_edge_is_8px_centred_on_the_hairline", async () => {
    await load(1280, 800);

    const geometry = await page.call<Geometry>(GEOMETRY);

    expect(geometry.edgeWidth).toBe(8);
    expect(Math.abs(geometry.edgeMid - geometry.railRight)).toBeLessThanOrEqual(1);
  });

  for (const [width, height] of [[1280, 800], [1280, 400]] as const) {
    it(`u391_the_button_spans_the_rail_bottom at ${width}x${height}`, async () => {
      await load(width, height);

      const geometry = await page.call<Geometry>(GEOMETRY);

      expect(Math.abs(geometry.footerBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.footerInWindow)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.footerLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.footerRight)).toBeLessThanOrEqual(1);
      expect(geometry.buttonHeight).toBeGreaterThanOrEqual(28);
      expect(Math.abs(geometry.scrollBottom)).toBeLessThanOrEqual(1);
    });
  }

  it("u391_scrolling_does_not_move_it", async () => {
    await load(1280, 400);

    const top = `() => document.querySelector(".rail-actions button").getBoundingClientRect().top`;
    const before = await page.call<number>(top);

    await page.call(`() => { const list = document.querySelector(".rail-scroll"); list.scrollTop = list.scrollHeight; }`);
    expect(await page.call<number>(top)).toBe(before);
    expect(await page.call<boolean>(`() => document.querySelector(".rail-scroll").scrollTop > 0`)).toBe(true);
  });

  it("u391_the_last_row_clears_it", async () => {
    await load(1280, 400);
    await page.call(`() => { const list = document.querySelector(".rail-scroll"); list.scrollTop = list.scrollHeight; }`);

    const gap = await page.call<number>(`() => {
      const rows = [...document.querySelectorAll(".rail-scroll [role=treeitem]")];
      return document.querySelector(".rail-actions").getBoundingClientRect().top - rows[rows.length - 1].getBoundingClientRect().bottom;
    }`);

    expect(gap).toBeGreaterThanOrEqual(0);
  });

  const FIT = `() => {
    const clipped = [...document.querySelectorAll(".rail-scroll *")].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible" && el.clientWidth > 0 && !el.closest(".rail-tree")?.hasAttribute("hidden"));
    const scroll = document.querySelector(".rail-scroll");
    const rows = [...document.querySelectorAll(".rail-scroll [role=treeitem]")].filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect());
    const overlap = rows.filter((row, index) => index > 0 && rows[index - 1].bottom - row.top > 1).length;
    return { sideways: scroll.scrollWidth > scroll.clientWidth, rail: document.querySelector(".rail").scrollWidth > document.querySelector(".rail").clientWidth, clipped: clipped.length, overlap, rows: rows.length };
  }`;

  for (const target of [252, 288, 360, 480]) {
    it(`u389_tree_40_fits_at_every_width at ${target}`, async () => {
      await load(1280, 800);
      expect(await railDrag(288, target)).toBe(target);

      const fit = await page.call<{ sideways: boolean; rail: boolean; clipped: number; overlap: number; rows: number }>(FIT);

      expect(fit.rows).toBeGreaterThan(10);
      expect([fit.sideways, fit.rail, fit.clipped, fit.overlap]).toEqual([false, false, 0, 0]);
    });
  }

  const shelfLoad = async () => {
    await load(1280, 800);
    await page.until(`() => { const el = document.querySelector(".shelf"); const left = el && el.getBoundingClientRect().left; const same = window.__last === left; window.__last = left; return Boolean(el) && same && left < window.innerWidth; }`);
  };

  it("u449_the_strip_stays_before_the_title_while_the_shelf_resizes", async () => {
    await shelfLoad();

    const offset = `() => Math.abs(document.querySelector(".strip").getBoundingClientRect().right - document.querySelector(".window-title").getBoundingClientRect().left)`;

    expect(await page.call<number>(offset)).toBeLessThanOrEqual(1);
    expect(await shelfDrag(960, 800)).toBe(480);
    expect(await page.call<number>(offset)).toBeLessThanOrEqual(1);
  });

  // U372's worst case: a 300-character title, ten open blockers, a 60-character Home and a 120-character Pad name, added through the fake Daemon.
  const WORST = `async () => {
    const app = window.__fake.app;
    window.__fake.actAs({ kind: "agent", id: "agent-1", parent: null });
    await app.rpc("todo.create", { title: "w".repeat(300), body: null, blockers: null });
    const blockers = [];
    for (let n = 0; n < 10; n++) blockers.push((await app.rpc("todo.create", { title: "blocker " + n, body: null, blockers: null })).id);
    await app.rpc("todo.create", { title: "blocked by ten", body: null, blockers });
    const home = await app.rpc("rail.createWorkstream", { name: "h".repeat(60), parent: null });
    const homed = await app.rpc("todo.create", { title: "homed in a long workstream", body: null, blockers: null });
    await app.rpc("todo.move", { id: homed.id, home: home.id });
    await app.rpc("pad.create", { name: "p".repeat(120), text: "preview ".repeat(80) });
    await new Promise((done) => setTimeout(done, 400));
  }`;

  const SIDEWAYS = `async (list) => {
    const tab = [...document.querySelectorAll('.shelf [role="tab"]')].find((own) => own.textContent.toLowerCase().startsWith(list));
    if (tab.getAttribute("aria-selected") !== "true") tab.click();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const shelf = document.querySelector(".shelf");
    const scrolling = [shelf, ...shelf.querySelectorAll("*")].filter((el) => el.scrollWidth > el.clientWidth + 1 && ["auto", "scroll"].includes(getComputedStyle(el).overflowX));
    return { rows: shelf.querySelectorAll(".shelf-row").length, shelf: shelf.scrollWidth - shelf.clientWidth, scrolling: scrolling.length };
  }`;

  it("u390_no_horizontal_scroll_at_the_limits", async () => {
    await shelfLoad();
    await page.call(WORST);

    for (const [from, to, expected] of [[960, 1040, 240], [1040, 720, 560]] as const) {
      expect(await shelfDrag(from, to)).toBe(expected);

      for (const list of ["todos", "pads"]) {
        const read = await page.call<{ rows: number; shelf: number; scrolling: number }>(SIDEWAYS, list);

        expect(read.rows, `${list} at ${expected}`).toBeGreaterThan(0);
        expect([read.shelf, read.scrolling], `${list} at ${expected}`).toEqual([0, 0]);
      }
    }
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U369 and U372 in a real Chromium: jsdom has no layout, so the strip's and the Shelf's boxes are read from the rendered harness. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U369 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

// The Shelf's open state persists in storage: a test that closes it must not close it for the next.
afterEach(async () => {
  await page.call(`() => localStorage.clear()`);
});

afterAll(async () => {
  await page?.close();
});

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=tree-40", width, height);
  await page.until(`() => Boolean(window.__fake) && document.querySelector(".shelf") !== null && document.querySelector(".strip") !== null`);
  // The Shelf slides in: wait until its leading edge has stopped.
  await page.until(`() => { const left = document.querySelector(".shelf").getBoundingClientRect().left; const same = window.__last === left; window.__last = left; return same && left < window.innerWidth; }`);
};

type Edges = { strip: number; shelf: number; button: number; scrollRight: number; plus: number; scrollable: boolean };

const EDGES = `() => {
  const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
  const scroll = document.querySelector(".strip-scroll");
  return {
    strip: rect(".strip").right,
    shelf: rect(".shelf").left,
    button: rect('.header [aria-label="show Shelf"]')?.left ?? -1,
    scrollRight: scroll.getBoundingClientRect().right,
    plus: rect(".strip-add").right,
    scrollable: document.querySelector(".tablist").scrollWidth >= document.querySelector(".tablist").clientWidth,
  };
}`;

run("u369 the strip ends at the Shelf's leading edge", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const [width, height] of [[1280, 820], [700, 800]] as const) {
    it(`u369_the_strip_ends_at_the_shelf_edge at ${width}x${height}`, async () => {
      await load(width, height);
      const edges = await page.call<Edges>(EDGES);

      expect(Math.abs(edges.strip - edges.shelf)).toBeLessThanOrEqual(1);
    });

    it(`u369_the_strip_scrolls_inside_the_remaining_width at ${width}x${height}`, async () => {
      await load(width, height);
      const edges = await page.call<Edges>(EDGES);

      expect(edges.scrollRight).toBeLessThanOrEqual(edges.shelf + 1);
      expect(edges.plus).toBeLessThanOrEqual(edges.shelf + 1);
    });

    it(`u369_closed_the_strip_ends_at_the_show_button at ${width}x${height}`, async () => {
      await load(width, height);
      await page.call(`() => document.querySelector('[aria-label="hide Shelf"]').click()`);
      await page.until(`() => document.querySelector('.header [aria-label="show Shelf"]') !== null`);
      const edges = await page.call<Edges>(EDGES);

      expect(Math.abs(edges.strip - edges.button)).toBeLessThanOrEqual(1);
      expect(edges.plus).toBeLessThanOrEqual(edges.button + 1);
    });
  }
});

run("u372 the Shelf's text", () => {
  it("u372_agent_text_is_left_aligned_ui_font", async () => {
    await load(1280, 820);

    const read = await page.call<{ align: string; family: string }>(
      `() => { const style = getComputedStyle(document.querySelector(".shelf")); return { align: style.textAlign, family: style.fontFamily }; }`,
    );

    expect(["left", "start"]).toContain(read.align);
    expect(read.family).toContain("sans");
  });

  it("u372_d12_d13_d14_hold_in_the_overlay", async () => {
    await load(1280, 820);
    await page.call(`async () => {
      const app = window.__fake.app;
      window.__fake.actAs({ kind: "agent", id: "agent-1", parent: null });
      await app.rpc("todo.create", { title: "w".repeat(300), body: null, blockers: null });
      const blockers = [];
      for (let n = 0; n < 10; n++) blockers.push((await app.rpc("todo.create", { title: "blocker " + n, body: null, blockers: null })).id);
      await app.rpc("todo.create", { title: "blocked by ten", body: null, blockers });
      const home = await app.rpc("rail.createWorkstream", { name: "h".repeat(60), parent: null });
      const homed = await app.rpc("todo.create", { title: "homed in a long workstream", body: null, blockers: null });
      await app.rpc("todo.move", { id: homed.id, home: home.id });
      await app.rpc("pad.create", { name: "p".repeat(120), text: null });
      await new Promise((done) => setTimeout(done, 400));
    }`);
    await page.call(`async () => {
      [...document.querySelectorAll('.shelf [role="tab"]')].find((tab) => tab.textContent.toLowerCase().startsWith("pads")).click();
      await new Promise((done) => setTimeout(done, 300));
    }`);
    const checks = await page.call<string>(`async () => JSON.stringify(await window.__checks())`);
    const parsed: Record<string, { status: string }> = JSON.parse(checks);

    for (const id of ["D12", "D13", "D14"]) expect(parsed[id], id).toMatchObject({ status: "pass" });
  });
});

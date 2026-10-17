import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U2228b in a real Chromium: the cut is measured with the real font, since jsdom has no layout. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U2228b needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const TAIL = `${"x".repeat(290)}-the-end`;

const RENAME = `async (name) => { await window.__fake.app.rpc("rail.rename", { id: "payments", name }); }`;

const READ = `() => {
  const title = document.querySelector(".window-title");
  const box = title.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(title);
  return { shown: title.textContent, full: title.getAttribute("title"), name: title.getAttribute("aria-label"), fits: title.scrollWidth <= title.clientWidth, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size, mid: box.left + box.width / 2, width: innerWidth };
}`;

type Read = { shown: string; full: string; name: string; fits: boolean; lines: number; mid: number; width: number };

const load = async (width: number) => {
  await page.load("/harness.html?seed=tree-40", width, 800);
  await page.until(`() => document.querySelectorAll(".rail-row").length > 10`);
};

const select = `() => { const row = [...document.querySelectorAll(".rail-row")].find((el) => el.textContent.startsWith("payments") || el.textContent.startsWith("pay")); row.click(); }`;

run("u2228b the window title keeps the name's start and end", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u2228b_a_short_title_is_whole", async () => {
    await load(1280);
    await page.call(select);
    await page.call(RENAME, "pay");
    await page.until(`() => document.querySelector(".window-title").getAttribute("title").endsWith("pay")`);

    const read = await page.call<Read>(READ);

    expect(read.shown).toBe(read.full);
    expect(read.shown).not.toContain("…");
  });

  for (const width of [1280, 1600]) {
    it(`u2228b_a_long_title_keeps_start_and_end at ${width}`, async () => {
      await load(width);
      await page.call(select);
      await page.call(RENAME, `payments ${TAIL}`);
      await page.until(`() => document.querySelector(".window-title").getAttribute("title").endsWith("-the-end")`);

      const read = await page.call<Read>(READ);

      expect(read.shown.split("…")).toHaveLength(2);
      expect(read.shown.endsWith("…")).toBe(false);
      expect(read.shown.endsWith("-the-end")).toBe(true);
      expect(read.shown.startsWith(read.full.slice(0, 4))).toBe(true);
      expect(read.fits).toBe(true);
      expect(read.lines).toBe(1);
      expect(Math.abs(read.mid - read.width / 2)).toBeLessThanOrEqual(1);
    });
  }

  it("u2228b_the_full_title_stays_in_name_and_window", async () => {
    await load(1280);
    await page.call(select);
    await page.call(RENAME, `payments ${TAIL}`);
    await page.until(`() => document.querySelector(".window-title").getAttribute("title").endsWith("-the-end")`);

    const read = await page.call<Read>(READ);
    const sent = await page.call<string[]>(`() => window.__fake.app.windowOperations.filter((op) => op.kind === "title").map((op) => op.title)`);

    expect(read.shown).not.toBe(read.full);
    expect(read.full.endsWith(TAIL)).toBe(true);
    expect(read.name).toBe(read.full);
    expect(sent.at(-1)).toBe(read.full);
  });

  it("u2228b_resize_recuts_the_title", async () => {
    await load(1600);
    await page.call(select);
    await page.call(RENAME, `payments ${TAIL}`);
    await page.until(`() => document.querySelector(".window-title").getAttribute("title").endsWith("-the-end")`);

    const wide = await page.call<Read>(READ);

    await page.resize(1280, 800);
    await page.until(`() => document.querySelector(".window-title").textContent.length < ${wide.shown.length}`);

    const narrow = await page.call<Read>(READ);

    expect(narrow.fits).toBe(true);
    expect(narrow.lines).toBe(1);
    expect(narrow.shown.endsWith("-the-end")).toBe(true);
    expect(Math.abs(narrow.mid - narrow.width / 2)).toBeLessThanOrEqual(1);

    await page.resize(1600, 800);
    await page.until(`() => document.querySelector(".window-title").textContent.length >= ${wide.shown.length}`);
  });

  for (const scheme of ["light", "dark"] as const) {
    it(`u2228b_title_keeps_checks in ${scheme}`, async () => {
      await page.scheme(scheme);
      await load(1280);

      const before = await page.call<Checks>(`() => window.__checks()`);

      await page.call(select);
      await page.call(RENAME, `payments ${TAIL}`);
      await page.until(`() => document.querySelector(".window-title").getAttribute("title").endsWith("-the-end")`);

      const after = await page.call<Checks>(`() => window.__checks()`);

      for (const id of CHECK_IDS) if (before[id].status === "pass") expect(after[id].status, id).toBe("pass");

      for (const id of ["D2", "D5", "D6"] as const) expect(after[id].status, id).toBe("pass");
    });
  }
});

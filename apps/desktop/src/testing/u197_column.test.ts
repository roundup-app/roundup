import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U197 in a real Chromium: jsdom has no layout, so the column, the left edge and the line length are read from the rendered Thread. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U197 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const ROWS = ".thread-header .thread-ask, .thread-header .thread-limits, .thread-sender, .thread-body, .thread-card-body, .thread-card-answer, .thread-composer textarea";

/** Page-side: the column, each row's first rendered glyph x and widest rendered line, and the width of `80ch` in the row's font. */
const READ = `() => {
  const column = document.querySelector(".thread-column").getBoundingClientRect();
  const rows = [...document.querySelectorAll(${JSON.stringify(ROWS)})].map((row) => {
    const style = getComputedStyle(row);
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:80ch;font-family:" + style.fontFamily + ";font-size:" + style.fontSize;
    document.body.append(probe);
    const limit = probe.getBoundingClientRect().width;
    probe.remove();
    const range = document.createRange();
    range.selectNodeContents(row);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
    const box = row.getBoundingClientRect();
    return {
      name: row.className || row.tagName,
      x: row.tagName === "TEXTAREA" ? box.left + parseFloat(style.paddingLeft) : Math.min(...rects.map((rect) => rect.left)),
      widest: row.tagName === "TEXTAREA" ? 0 : Math.max(...rects.map((rect) => rect.width)),
      limit,
      lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
    };
  });
  return { column: { left: column.left, width: column.width, measure: parseFloat(getComputedStyle(document.documentElement).fontSize) * 32 }, rows };
}`;

type Read = { column: { left: number; width: number; measure: number }; rows: { name: string; x: number; widest: number; limit: number; lines: number }[] };

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=thread-report", width, height);
  await page.until(`() => document.querySelectorAll("[data-message-body]").length > 0 && Boolean(document.querySelector(".thread-composer textarea"))`);
};

run("u197 the Thread is one page in one column", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const [width, height] of [[1280, 800], [700, 800]] as const) {
    it(`u197_every_row_starts_at_one_x_and_no_line_exceeds_the_measure at ${width}x${height}`, async () => {
      await load(width, height);

      const { column, rows } = await page.call<Read>(READ);

      expect(rows.length).toBeGreaterThanOrEqual(7);
      expect(column.width).toBeLessThanOrEqual(column.measure + 1);

      for (const row of rows) {
        expect(Math.abs(row.x - rows[0]!.x), `${row.name} starts at ${row.x}, not ${rows[0]!.x}`).toBeLessThanOrEqual(1);
        expect(row.widest, row.name).toBeLessThanOrEqual(row.limit + 1);
      }

      // The 140-character order wraps inside the column, never past it.
      expect(rows.find((row) => row.name.includes("thread-ask"))!.lines).toBeGreaterThan(1);
    });

    it(`u197_d11_reads_pass_on_the_rendered_thread at ${width}x${height}`, async () => {
      await load(width, height);

      const d11 = await page.call<{ status: string }>(`() => window.__checks().D11`);

      expect(d11, JSON.stringify(d11)).toMatchObject({ status: "pass" });
    });
  }

  it("u197_the_takeover_header_sits_above_the_terminal_pane", async () => {
    await load(1280, 800);
    await page.call(`() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "take over" || b.textContent === "take over").click()`);
    await page.until(`() => [...document.querySelectorAll("[data-thread-header] button")].some((b) => b.textContent === "end takeover")`);

    const above = await page.call<boolean>(`() => {
      const header = document.querySelector("[data-thread-header]").getBoundingClientRect();
      const terminal = document.querySelector(".pane-screen");
      return Boolean(terminal) && header.bottom <= terminal.getBoundingClientRect().top + 1;
    }`);

    expect(above).toBe(true);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U2228a in a real Chromium: a Workstream name that goes from fitting to cut moves no row and keeps its one line. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U2228a needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const ROWS = `() => [...document.querySelectorAll(".rail-row")].map((row) => { const box = row.getBoundingClientRect(); return [row.getAttribute("aria-label") ?? row.textContent, box.top, box.height]; })`;

const RENAME = `async (name) => { await window.__fake.app.rpc("rail.rename", { id: "payments", name }); }`;

run("u2228a the Rail rows do not move", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u2228a_rail_rows_do_not_move", async () => {
    await page.load("/harness.html?seed=tree-40", 1280, 800);
    await page.until(`() => document.querySelectorAll(".rail-row").length > 10`);

    await page.call(RENAME, "pay");
    await page.until(`() => !!document.querySelector(".rail-row .name") && [...document.querySelectorAll(".rail-row .name")].some((el) => el.textContent === "pay")`);

    const fits = await page.call<[string, number, number][]>(ROWS);

    await page.call(RENAME, `payments workstream ${"with a very long tail ".repeat(4)}`.trim());
    await page.until(`() => [...document.querySelectorAll(".rail-row .name")].some((el) => el.scrollWidth > el.clientWidth)`);

    const cut = await page.call<[string, number, number][]>(ROWS);

    expect(cut.map(([, top, height]) => [top, height])).toEqual(fits.map(([, top, height]) => [top, height]));

    const lines = await page.call<number>(`() => { const name = [...document.querySelectorAll(".rail-row .name")].find((el) => el.scrollWidth > el.clientWidth); return name.getClientRects().length; }`);
    expect(lines).toBe(1);
  });
});

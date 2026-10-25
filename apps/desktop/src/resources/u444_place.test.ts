import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U444 requires Chromium");
  page = await openPage(chrome);
  await page.load("/harness.html?seed=resources", 1280, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => localStorage.setItem("roundup:shelf:/Users/you/harness", JSON.stringify({open: false, tab: "todos"}))`);
}, 90_000);

afterAll(async () => { await page?.close(); });

it("u408_the_rail_holds_none_of_it", async () => {
  for (const seed of ["tree-40", "agents-10"]) {
    await page.load(`/harness.html?seed=${seed}`, 1280, 800);
    await page.until(`() => Boolean(document.querySelector('.rail-row'))`);
    expect(await page.call(`() => document.querySelectorAll('.rail .resource-value, .rail .resource-num, .rail .resource-stale').length`)).toBe(0);
  }
}, 60_000);

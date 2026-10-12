import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;
beforeAll(async () => {
  const chrome = chromePath();
  if (!chrome) throw new Error("U441 requires headless Chromium");
  page = await openPage(chrome);
}, 60_000);
afterAll(async () => { await page?.close(); });

it("u441_token_surfaces_keep_contrast", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);
    await page.load("/harness.html?seed=agents-10", 1280, 820);
    await page.until("() => document.querySelector('[role=tab]') && window.__checks");
    const surface = await page.call<string>("() => getComputedStyle(document.querySelector('.header')).backgroundColor");
    expect(surface).toBe(scheme === "light" ? "rgb(128, 128, 128)" : "rgb(28, 28, 30)");
  }
}, 60_000);

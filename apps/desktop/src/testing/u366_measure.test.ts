import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U366 in a real Chromium: the Thread's column grows past its old 32rem at 1600 px and fills the window at 700 px. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U366 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=thread-report", width, height);
  await page.until(`() => document.querySelectorAll("[data-message-body]").length > 0 && Boolean(document.querySelector(".thread-composer textarea"))`);
};

type Read = { column: number; rem: number; scroll: number; client: number; body: number; probe: number };

const READ = `() => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const body = document.querySelector("[data-message-body]");
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;width:120ch;font-family:" + getComputedStyle(body).fontFamily + ";font-size:" + getComputedStyle(body).fontSize;
  document.body.append(probe);
  const read = { column: document.querySelector(".thread-column").getBoundingClientRect().width, rem, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, body: body.getBoundingClientRect().width, probe: probe.getBoundingClientRect().width };
  probe.remove();
  return read;
}`;

run("u366 the Thread keeps a 120-character measure", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u366_the_column_grows_at_1600_and_fills_the_window_at_700", async () => {
    await load(1600, 800);

    const wide = await page.call<Read>(READ);

    expect(wide.column).toBeGreaterThan(wide.rem * 32);
    expect(wide.body).toBeLessThanOrEqual(wide.probe + 1);

    await load(700, 800);

    const narrow = await page.call<Read>(READ);

    expect(narrow.column).toBeLessThanOrEqual(700);
    expect(narrow.scroll).toBeLessThanOrEqual(narrow.client);
  });
});

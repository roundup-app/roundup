import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U354 in a real Chromium: jsdom has no layout, so a 12-line pinned question is read against the rendered order line and composer. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U354");

beforeAll(async () => {
  if (!found) throw new Error("U354 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const PIN = `() => {
  const ask = document.querySelector(".thread-header .thread-ask");
  const box = ask.getBoundingClientRect();
  const below = document.querySelector(".thread-header .thread-limits, .thread-header .thread-toggle")?.getBoundingClientRect();
  ask.scrollTop = ask.scrollHeight;
  const range = document.createRange();
  range.selectNodeContents(ask);
  const last = [...range.getClientRects()].at(-1);
  return { full: ask.hasAttribute("data-full"), askBottom: box.bottom, belowTop: below ? below.top : null, lastBottom: last.bottom, lastTop: last.top, boxTop: box.top, boxHeight: box.height, scrolls: ask.scrollHeight > ask.clientHeight };
}`;

type Pin = { full: boolean; askBottom: number; belowTop: number | null; lastBottom: number; lastTop: number; boxTop: number; boxHeight: number; scrolls: boolean };

run("u354 a pinned question shows its last line", () => {
  vi.setConfig({ testTimeout: 90_000 });

  for (const [width, height] of [[1280, 800], [700, 800]] as const) {
    it(`u354_a_pinned_question_shows_its_last_line_above_the_order_line at ${width}x${height}`, async () => {
      await page.load("/harness.html?seed=pinned-question", width, height);
      await page.until(`() => Boolean(document.querySelector(".thread-header .thread-ask")) && Boolean(document.querySelector(".thread-composer textarea"))`, 60_000);

      const pin = await page.call<Pin>(PIN);

      expect(pin.full).toBe(true);
      expect(pin.boxHeight).toBeLessThanOrEqual(height * 0.4 + 1);
      expect(pin.lastBottom).toBeLessThanOrEqual(pin.askBottom + 1);
      expect(pin.lastTop).toBeGreaterThanOrEqual(pin.boxTop - 1);

      if (pin.belowTop !== null) expect(pin.askBottom).toBeLessThanOrEqual(pin.belowTop + 1);

      mkdirSync(ART, { recursive: true });
      writeFileSync(join(ART, `pinned-${width}x${height}.png`), Buffer.from(await page.shot(), "base64"));
      writeFileSync(join(ART, `pinned-${width}x${height}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
    });
  }
});

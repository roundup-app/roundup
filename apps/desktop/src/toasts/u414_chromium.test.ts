import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U414: a Toast sits inside the viewport, at the bottom-right, and covers neither the Thread's input nor the header (title and traffic lights). */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

const ART = resolve(process.cwd(), "../../artifacts/ux/U410");

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U414 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const MEASURE = `() => {
  const box = (selector) => { const element = document.querySelector(selector); if (!element) return null; const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  return { toasts: [...document.querySelectorAll('.toast')].map((element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }), composer: box('.thread-composer'), header: box('.header'), width: innerWidth, height: innerHeight, checks: window.__checks ? window.__checks() : null };
}`;

type Box = { left: number; top: number; right: number; bottom: number };

const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

run("u414 a Toast is never in the way", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const [width, height] of [[1280, 820], [700, 800]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      it(`u414_a_toast_never_covers_the_input_title_or_traffic_lights at ${width}x${height} ${scheme}`, async () => {
        await page.scheme(scheme);
        await page.load("/harness.html?seed=thread-report", width, height);
        await page.until(`() => Boolean(window.__fake) && document.querySelector(".thread-composer") !== null`);
        await page.call(`() => { for (let at = 0; at < 4; at++) window.__fake.emit({ actor: { kind: "user", id: "you", parent: null }, name: "agent.status", data: { id: "an-agent-with-a-rather-long-name-" + at, attempt: "1", status_revision: "9", status: { kind: "needs-you", label: "?", since: Date.now() } } }); }`);
        await page.until(`() => document.querySelectorAll(".toast").length === 3`);

        const read = await page.call<{ toasts: Box[]; composer: Box; header: Box; width: number; height: number; checks: unknown }>(MEASURE);

        mkdirSync(ART, { recursive: true });
        writeFileSync(resolve(ART, `toasts-${width}x${height}-${scheme}.checks.json`), JSON.stringify(read.checks, null, 2));

        expect(read.toasts).toHaveLength(3);

        for (const toast of read.toasts) {
          expect(toast.left).toBeGreaterThanOrEqual(0);
          expect(toast.top).toBeGreaterThanOrEqual(read.header.bottom);
          expect(toast.right).toBeLessThanOrEqual(read.width);
          expect(toast.bottom).toBeLessThanOrEqual(read.height);
          expect(toast.right).toBeGreaterThan(read.width - 64);
          expect(meets(toast, read.composer)).toBe(false);
          expect(meets(toast, read.header)).toBe(false);
        }
      });
    }
  }
});

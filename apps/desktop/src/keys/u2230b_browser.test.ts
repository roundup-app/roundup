import { afterAll, beforeAll, expect, it } from "vitest";
import { hintsFor } from "./chords";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2230b requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

type Read = { shown: string[] };

const read = `() => {
  const shown = [...document.querySelector('.hint-line').children].filter(child => !child.hidden);
  return { shown: shown.map(child => child.textContent.replace(/\\s+/g, ' ').trim()) };
}`;

it("u2230b_hint_line_drops_from_the_end", async () => {
  for (const [scheme, contrast] of [["light", undefined], ["dark", undefined], ["light", "more"]] as const) {
    await page.scheme(scheme, contrast);

    for (const [seed, agent] of [["tree-40", "agent-4"], ["bubbles", "dense"]] as const) {
      for (const width of [1280, 700]) {
        await page.load(`/harness.html?seed=${seed}`, width, 800);
        await page.call(`() => localStorage.clear()`);
        await page.load(`/harness.html?seed=${seed}`, width, 800);
        await page.until(`() => Boolean(window.__fake)`);
        await page.call(`() => document.querySelector('[data-id="${agent}"]').click()`);
        await page.until(`() => document.querySelector('.pane-control[data-state=managed]')`);

        // The Shelf opens by default at 700 and leaves the bar no room: close it, as a user would.
        if (width === 700) {
          await page.call(`() => document.querySelector('.pane-screen textarea, .pane-screen [tabindex]').focus()`);
          await page.press("k", "KeyK", 4);
          await page.press("s", "KeyS");
        }

        await page.call(`() => document.querySelector('.pane-screen textarea, .pane-screen [tabindex]').focus()`);
        await page.until(`() => document.querySelector('.hint-line .hint:not([hidden])')`);

        if (seed === "bubbles") expect(await page.call<number>(`() => document.querySelectorAll('.terminal-tab').length`), "the Agent with 8 Runs").toBeGreaterThanOrEqual(8);

        const observed = await page.call<Read>(read);

        const label = `${scheme} ${contrast ?? ""} ${seed} ${width}`;
        const wanted = hintsFor("agent").map((hint) => `${hint.keys} ${hint.label}`);

        expect(observed.shown.length, label).toBeGreaterThan(0);
        expect(observed.shown, `${label}: fewer hints drop from the end`).toEqual(wanted.slice(0, observed.shown.length));

      }
    }
  }
}, 300_000);

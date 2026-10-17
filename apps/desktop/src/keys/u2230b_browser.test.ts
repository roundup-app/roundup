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

type Read = {
  shown: string[]; fits: boolean; inBar: boolean; clearOfBar: boolean; quiet: boolean; secondary: boolean; checks: Record<string, { status: string }>;
};

const read = `() => {
  const line = document.querySelector('.hint-line');
  const box = (element) => element.getBoundingClientRect();
  const lineBox = box(line);
  const shown = [...line.children].filter(child => !child.hidden);
  const style = getComputedStyle(line);
  const probe = document.createElement('i');
  probe.style.color = 'var(--grey)';
  document.body.append(probe);
  const secondary = getComputedStyle(probe).color === style.color;
  probe.remove();
  const bar = box(document.querySelector('.resource-strip'));
  const others = ['.terminal-tabs-host', '.resource-agent'].map(selector => document.querySelector(selector)).filter(Boolean).map(box);
  return {
    shown: shown.map(child => child.textContent.replace(/\\s+/g, ' ').trim()),
    fits: shown.every(child => box(child).right <= lineBox.right && box(child).left >= lineBox.left && box(child).bottom <= lineBox.bottom),
    inBar: lineBox.left >= bar.left && lineBox.right <= bar.right && lineBox.top >= bar.top && lineBox.bottom <= bar.bottom,
    clearOfBar: others.every(other => lineBox.bottom <= other.top || other.width === 0),
    quiet: style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none' && style.borderTopWidth === '0px' && style.outlineStyle === 'none' && style.boxShadow === 'none' && style.pointerEvents === 'none' && line.tabIndex === -1,
    secondary,
    checks: window.__checks(),
  };
}`;

it("u2230b_hint_line_is_quiet_and_fits", async () => {
  for (const [scheme, contrast] of [["light", undefined], ["dark", undefined], ["light", "more"]] as const) {
    await page.scheme(scheme, contrast);

    for (const [seed, agent] of [["tree-40", "agent-4"], ["bubbles", "dense"]] as const) {
      for (const width of [1280, 700]) {
        await page.load(`/harness.html?seed=${seed}`, width, 800);
        await page.call(`() => localStorage.clear()`);
        await page.load(`/harness.html?seed=${seed}`, width, 800);
        await page.until(`() => Boolean(window.__fake)`);
        await page.call(`() => document.querySelector('[data-id="${agent}"]').click()`);
        await page.until(`() => document.querySelector('.pane-watch')`);

        // The Shelf opens by default at 700 and leaves the bar no room: close it, as a user would.
        if (width === 700) {
          await page.call(`() => document.querySelector('.pane-screen textarea, .pane-screen [tabindex]').focus()`);
          await page.press("\\", "Backslash", 4);
        }

        await page.call(`() => document.querySelector('.pane-screen textarea, .pane-screen [tabindex]').focus()`);
        await page.until(`() => document.querySelector('.hint-line .hint:not([hidden])')`);

        if (seed === "bubbles") expect(await page.call<number>(`() => document.querySelectorAll('.terminal-tab').length`), "the Agent with 8 Runs").toBeGreaterThanOrEqual(8);

        const observed = await page.call<Read>(read);

        const label = `${scheme} ${contrast ?? ""} ${seed} ${width}`;
        const wanted = hintsFor("agent").map((hint) => `${hint.keys} ${hint.label}`);

        expect(observed.shown.length, label).toBeGreaterThan(0);
        expect(observed.shown, `${label}: fewer hints drop from the end`).toEqual(wanted.slice(0, observed.shown.length));
        expect({ fits: observed.fits, inBar: observed.inBar, clearOfBar: observed.clearOfBar, quiet: observed.quiet, secondary: observed.secondary }, label)
          .toEqual({ fits: true, inBar: true, clearOfBar: true, quiet: true, secondary: true });

        for (const [id, check] of Object.entries(observed.checks)) {
          if (["D2", "D5", "D6"].includes(id)) expect(check.status, `${label} ${id}`).toBe("pass");
        }
      }
    }
  }
}, 300_000);

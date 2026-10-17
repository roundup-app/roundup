import { afterAll, beforeAll, expect, it } from "vitest";
import type { ChromePage } from "../testing/chromePage";
import { openBubblePage, showBubble } from "./u2307_browser";

let page: ChromePage;

beforeAll(async () => { page = await openBubblePage(); }, 90_000);

afterAll(async () => { await page?.close(); });

const read = `() => {
  const header = document.querySelector('.bubble:not([hidden]) .bubble-header').getBoundingClientRect();
  const mid = (el) => { const r = el.getBoundingClientRect(); return r.x + r.width / 2; };
  const buttons = [...document.querySelectorAll('.bubble:not([hidden]) .bubble-header button')];
  const name = document.querySelector('.bubble:not([hidden]) .bubble-name');
  const dot = document.querySelector('.bubble:not([hidden]) .bubble-state');
  const looks = buttons.map((b) => { const s = getComputedStyle(b); return [s.borderTopWidth, s.outlineStyle, s.backgroundColor, s.boxShadow]; });
  return { height: header.height, order: buttons.map((b) => b.getAttribute('aria-label')), xs: buttons.map(mid), hits: buttons.map((b) => [b.getBoundingClientRect().width, b.getBoundingClientRect().height]),
    nameCentre: mid(name) - (header.x + header.width / 2), size: getComputedStyle(name).fontSize, looks, dotAfter: dot.getBoundingClientRect().left >= name.getBoundingClientRect().right,
    dotName: dot.getAttribute('aria-label'), dotColour: getComputedStyle(dot).backgroundColor };
}`;

type Bar = { height: number; order: string[]; xs: number[]; hits: number[][]; nameCentre: number; size: string; looks: string[][]; dotAfter: boolean; dotName: string; dotColour: string };

it("u2307c_the_bar_is_28_high_with_close_then_minimise_dots_and_a_centred_title_and_status_dot", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await showBubble(page, scheme);

    const bar = await page.call<Bar>(read);

    expect(bar.height, scheme).toBe(28);
    expect(bar.order, scheme).toEqual(["Close", "Minimise"]);
    expect(bar.xs[0]!, scheme).toBeLessThan(bar.xs[1]!);
    expect(Math.abs(bar.nameCentre), `${scheme} the title is centred on the bar`).toBeLessThanOrEqual(1);
    expect(bar.size, scheme).toBe("13px");
    expect(bar.dotAfter, scheme).toBe(true);
    expect(bar.dotName, scheme).toMatch(/^Running$|^Exit /);

    for (const [index, look] of bar.looks.entries()) {
      expect(look[0], `${scheme} border`).toBe("0px");
      expect(look[2], `${scheme} fill`).toBe("rgba(0, 0, 0, 0)");
      expect(look[3], `${scheme} shadow`).toBe("none");
      expect(bar.hits[index]![0], scheme).toBeGreaterThanOrEqual(24);
      expect(bar.hits[index]![1], scheme).toBeGreaterThanOrEqual(24);
    }
  }
}, 120_000);

it("u2307c_a_long_title_truncates_before_it_reaches_a_dot", async () => {
  await showBubble(page);
  await page.call(`() => { document.querySelector('.bubble:not([hidden]) .bubble-name').textContent = 'a'.repeat(300); }`);

  const gap = await page.call<number>(`() => { const n = document.querySelector('.bubble:not([hidden]) .bubble-name').getBoundingClientRect(); const d = document.querySelector('.bubble:not([hidden]) [aria-label="Minimise"]').getBoundingClientRect(); return n.left - d.right; }`);

  expect(gap).toBeGreaterThanOrEqual(0);
}, 60_000);

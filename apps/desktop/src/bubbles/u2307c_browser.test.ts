import { afterAll, beforeAll, expect, it } from "vitest";
import type { ChromePage } from "../testing/chromePage";
import { openBubblePage, showBubble } from "../testing/u2307Browser";

let page: ChromePage;

beforeAll(async () => { page = await openBubblePage(); }, 90_000);

afterAll(async () => { await page?.close(); });

const read = `() => {
  const buttons = [...document.querySelectorAll('.bubble:not([hidden]) .bubble-header button')];
  const dot = document.querySelector('.bubble:not([hidden]) .bubble-state');
  return { order: buttons.map((b) => b.getAttribute('aria-label')), dotName: dot.getAttribute('aria-label') };
}`;

type Bar = { order: string[]; dotName: string };

it("u2307c_the_bar_has_close_then_minimise_dots_and_a_status_dot_named_by_state", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await showBubble(page, scheme);

    const bar = await page.call<Bar>(read);

    expect(bar.order, scheme).toEqual(["Close", "Minimise"]);
    expect(bar.dotName, scheme).toMatch(/^Running$|^Exit /);
  }
}, 120_000);

it("u2307c_a_hovered_dot_shows_a_glyph_that_differs_from_its_disc_and_the_disc_follows_the_ink", async () => {
  const dot = `() => { const b = document.querySelector('.bubble:not([hidden]) [aria-label="Close"]'); const d = b.querySelector('.bubble-dot'); const r = d.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disc: getComputedStyle(d).backgroundColor, glyph: getComputedStyle(d.querySelector('svg')).color }; }`;

  for (const scheme of ["light", "dark"] as const) {
    await showBubble(page, scheme);
    await page.hover(1, 1);
    const rest = await page.call<{ x: number; y: number; disc: string }>(dot);

    await page.hover(rest.x, rest.y);
    const hovered = await page.call<{ disc: string; glyph: string }>(dot);
    await page.pointer("down", rest.x, rest.y);
    const pressed = await page.call<{ disc: string }>(dot);
    await page.pointer("up", 1, 1);

    expect(hovered.glyph, `${scheme} glyph differs from disc`).not.toBe(hovered.disc);
    expect(hovered.disc, `${scheme} hover moves the ink`).not.toBe(rest.disc);
    expect(pressed.disc, `${scheme} press dims it`).not.toBe(hovered.disc);
  }
}, 120_000);

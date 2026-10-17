import { afterAll, beforeAll, expect, it } from "vitest";
import type { ChromePage } from "../testing/chromePage";
import { openBubblePage, showBubble } from "../testing/u2307Browser";

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
    nameCentre: mid(name) - (header.x + header.width / 2), controlsAfter: buttons.every((b) => b.getBoundingClientRect().left >= dot.getBoundingClientRect().right), size: getComputedStyle(name).fontSize, looks, dotAfter: dot.getBoundingClientRect().left >= name.getBoundingClientRect().right,
    dotName: dot.getAttribute('aria-label'), dotColour: getComputedStyle(dot).backgroundColor };
}`;

type Bar = { height: number; order: string[]; xs: number[]; hits: number[][]; nameCentre: number; controlsAfter: boolean; size: string; looks: string[][]; dotAfter: boolean; dotName: string; dotColour: string };

it("u2307c_the_bar_is_28_high_with_close_then_minimise_dots_and_a_centred_title_and_status_dot", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await showBubble(page, scheme);

    const bar = await page.call<Bar>(read);

    expect(bar.height, scheme).toBe(28);
    expect(bar.order, scheme).toEqual(["Close", "Minimise"]);
    expect(bar.xs[0]!, scheme).toBeLessThan(bar.xs[1]!);
    expect(bar.controlsAfter, `${scheme} U3704: the dots trail the status Glyph`).toBe(true);
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

  const gap = await page.call<number>(`() => { const n = document.querySelector('.bubble:not([hidden]) .bubble-name').getBoundingClientRect(); const d = document.querySelector('.bubble:not([hidden]) [aria-label="Close"]').getBoundingClientRect(); return d.left - n.right; }`);

  expect(gap).toBeGreaterThanOrEqual(0);
}, 60_000);

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

it("u2307c_each_glyph_is_centred_in_its_dot_within_half_a_pixel", async () => {
  const centres = `() => [...document.querySelectorAll('.bubble:not([hidden]) .bubble-header .bubble-dot')].map((d) => {
    const dot = d.getBoundingClientRect();
    const g = d.querySelector('svg path').getBoundingClientRect();
    return { dx: g.x + g.width / 2 - (dot.x + dot.width / 2), dy: g.y + g.height / 2 - (dot.y + dot.height / 2) };
  })`;

  for (const scheme of ["light", "dark"] as const) {
    await showBubble(page, scheme);
    await page.hover(1, 1);

    const offsets = await page.call<{ dx: number; dy: number }[]>(centres);

    expect(offsets, scheme).toHaveLength(2);

    for (const { dx, dy } of offsets) {
      expect(Math.abs(dx), `${scheme} horizontal`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(dy), `${scheme} vertical`).toBeLessThanOrEqual(0.5);
    }
  }
}, 120_000);

const gaps = `() => {
  const bubble = document.querySelector('.bubble:not([hidden])').getBoundingClientRect();
  const body = document.querySelector('.bubble:not([hidden]) .bubble-body').getBoundingClientRect();
  const bar = document.querySelector('.bubble:not([hidden]) .bubble-header').getBoundingClientRect();
  const screen = document.querySelector('.bubble:not([hidden]) .xterm-screen').getBoundingClientRect();
  const measure = document.querySelector('.bubble:not([hidden]) .xterm-char-measure-element');
  const rows = document.querySelector('.bubble:not([hidden]) .xterm-rows').children.length;

  return { left: body.left - bubble.left, right: bubble.right - body.right, bottom: bubble.bottom - body.bottom, band: body.top - bar.bottom,
    spareX: body.right - screen.right, spareY: body.bottom - screen.bottom, cellW: measure.getBoundingClientRect().width / measure.textContent.length, cellH: screen.height / rows, inset: parseFloat(getComputedStyle(document.body).getPropertyValue('--space-1')) };
}`;

type Gaps = { left: number; right: number; bottom: number; band: number; spareX: number; spareY: number; cellW: number; cellH: number; inset: number };

it("u2307c_the_terminal_sits_the_small_inset_from_the_left_right_and_bottom_and_meets_the_bar_at_the_default_size_and_after_a_resize", async () => {
  await showBubble(page);

  const check = async (when: string) => {
    // The fit runs a frame after the frame changes; wait for it to settle.
    await page.until(`() => { const g = (${gaps})(); return g.spareX >= 0 && g.spareX < g.cellW && g.spareY >= 0 && g.spareY < g.cellH; }`);

    const g = await page.call<Gaps>(gaps);

    expect([g.left, g.right, g.bottom], when).toEqual([g.inset, g.inset, g.inset]);
    expect(g.band, `${when} the bar meets the Terminal`).toBe(0);
    expect(g.spareX, `${when} spare width is under a cell`).toBeGreaterThanOrEqual(0);
    expect(g.spareX, `${when} spare width is under a cell`).toBeLessThan(g.cellW);
    expect(g.spareY, `${when} spare height is under a cell`).toBeGreaterThanOrEqual(0);
    expect(g.spareY, `${when} spare height is under a cell`).toBeLessThan(g.cellH);
  };

  await check("default");
  await page.call(`() => { const b = document.querySelector('.bubble:not([hidden])'); b.style.width = (b.getBoundingClientRect().width - 97) + 'px'; b.style.height = (b.getBoundingClientRect().height - 61) + 'px'; }`);
  await check("resized");
}, 60_000);

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U389 to U391 in a real Chromium: jsdom has no layout, so widths, the footer and the Edge's hit area are read from the rendered window. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U389 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const load = async (width: number, height: number) => {
  await page.load("/harness.html?seed=tree-40", width, height);
  await page.until(`() => Boolean(document.querySelector(".rail-actions button"))`);
};

const DRAG = `(from, to) => new Promise((resolve) => {
  const edge = document.querySelector('[aria-label="resize Rail"]');
  const fire = (type, x) => edge.dispatchEvent(new PointerEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true, pointerId: 1 }));
  fire("pointerdown", from);
  fire("pointermove", to);
  requestAnimationFrame(() => { fire("pointerup", to); resolve(document.querySelector(".rail").getBoundingClientRect().width); });
})`;

const GEOMETRY = `() => {
  const rail = document.querySelector(".rail").getBoundingClientRect();
  const footer = document.querySelector(".rail-actions").getBoundingClientRect();
  const button = document.querySelector(".rail-actions button").getBoundingClientRect();
  const centre = document.querySelector(".centre").getBoundingClientRect();
  const scroll = document.querySelector(".rail-scroll");
  const edge = document.querySelector('[aria-label="resize Rail"]').getBoundingClientRect();
  return { rail: rail.width, railRight: rail.right, centre: centre.width, footerBottom: footer.bottom - rail.bottom, footerInWindow: window.innerHeight - footer.bottom, footerLeft: footer.left - rail.left, footerRight: rail.right - footer.right, buttonHeight: button.height, buttonWidth: button.width, scrollBottom: scroll.getBoundingClientRect().bottom - footer.top, edgeWidth: edge.width, edgeMid: (edge.left + edge.right) / 2 };
}`;

type Geometry = { rail: number; railRight: number; centre: number; footerBottom: number; footerInWindow: number; footerLeft: number; footerRight: number; buttonHeight: number; buttonWidth: number; scrollBottom: number; edgeWidth: number; edgeMid: number };

run("u389 to u391 in the rendered page", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("u389_default_is_288_and_252_at_640", async () => {
    await load(1280, 800);
    expect((await page.call<Geometry>(GEOMETRY)).rail).toBe(288);
    await load(640, 400);

    const small = await page.call<Geometry>(GEOMETRY);

    expect([small.rail, small.centre]).toEqual([252, 388]);
  });

  it("u389_a_drag_sets_the_width_and_clamps", async () => {
    await load(1280, 800);
    expect(await page.call<number>(`() => (${DRAG})(288, 360)`)).toBe(360);
    expect(await page.call<number>(`() => (${DRAG})(360, 900)`)).toBe(480);
    expect(await page.call<number>(`() => (${DRAG})(480, 10)`)).toBe(252);
  });

  it("u389_the_room_binds_at_800", async () => {
    await load(800, 800);
    expect(await page.call<number>(`() => (${DRAG})(288, 900)`)).toBe(412);
  });

  it("u389_the_edge_is_8px_centred_on_the_hairline", async () => {
    await load(1280, 800);

    const geometry = await page.call<Geometry>(GEOMETRY);

    expect(geometry.edgeWidth).toBe(8);
    expect(Math.abs(geometry.edgeMid - geometry.railRight)).toBeLessThanOrEqual(1);
  });

  for (const [width, height] of [[1280, 800], [700, 800], [640, 400]] as const) {
    it(`u391_the_button_spans_the_rail_bottom at ${width}x${height}`, async () => {
      await load(width, height);

      const geometry = await page.call<Geometry>(GEOMETRY);

      expect(Math.abs(geometry.footerBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.footerInWindow)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.footerLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.footerRight)).toBeLessThanOrEqual(1);
      expect(geometry.buttonHeight).toBeGreaterThanOrEqual(28);
      expect(Math.abs(geometry.scrollBottom)).toBeLessThanOrEqual(1);
    });
  }

  it("u391_scrolling_does_not_move_it", async () => {
    await load(1280, 400);

    const top = `() => document.querySelector(".rail-actions button").getBoundingClientRect().top`;
    const before = await page.call<number>(top);

    await page.call(`() => { const list = document.querySelector(".rail-scroll"); list.scrollTop = list.scrollHeight; }`);
    expect(await page.call<number>(top)).toBe(before);
    expect(await page.call<boolean>(`() => document.querySelector(".rail-scroll").scrollTop > 0`)).toBe(true);
  });
});

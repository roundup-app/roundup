import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2236 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const open = async (): Promise<void> => {
  await page.load("/harness.html?seed=bubbles", 1280, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
  await page.until(`() => document.querySelector('button.terminal-tab')`);
  await page.call(`() => { const tab = document.querySelector('button.terminal-tab'); if (document.querySelector('.bubble')?.hidden) tab.click(); }`);
  await page.until(`() => document.querySelector('.bubble:not([hidden]) .bubble-header') && document.querySelector('.bubble-zone:not([hidden])')`);
};

type Look = { name: string; cursor: string; paint: string[]; hit: string | null; overlaps: string[] };

const probe = `() => [...document.querySelectorAll('.bubble-zone:not([hidden])')].map((zone) => {
  const style = getComputedStyle(zone);
  const box = zone.getBoundingClientRect();
  const bars = [...document.querySelectorAll('.bubble-body .xterm-viewport')].map((view) => { const v = view.getBoundingClientRect(); const body = view.closest('.bubble-body').getBoundingClientRect(); const r = { right: v.right, top: Math.max(v.top, body.top), bottom: Math.min(v.bottom, body.bottom) }; const w = view.offsetWidth - view.clientWidth; return { getBoundingClientRect: () => ({ left: r.right - w, right: r.right, top: r.top, bottom: r.bottom }), getAttribute: () => 'scrollbar', className: '' }; });
  const controls = [...document.querySelectorAll('.bubble-header button'), ...bars.filter((bar) => bar.getBoundingClientRect().right > bar.getBoundingClientRect().left)];
  const touch = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return {
    name: zone.dataset.zone,
    cursor: style.cursor,
    paint: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth, style.outlineStyle, style.boxShadow, style.backgroundImage, style.backgroundColor, style.opacity].map(String),
    overlaps: controls.filter((control) => touch(box, control.getBoundingClientRect())).map((control) => control.getAttribute('aria-label') ?? control.className),
  };
})`;

it("u2236_zones_show_native_cursors_draw_nothing_and_leave_the_controls_clear", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);
    await open();

    const looks = await page.call<Look[]>(probe);

    expect(Object.fromEntries(looks.map((look) => [look.name, look.cursor]))).toEqual({ n: "ns-resize", s: "ns-resize", w: "ew-resize", e: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" });

    for (const look of looks) {
      expect(look.paint, look.name).toEqual(["0px", "0px", "0px", "0px", "none", "none", "none", "rgba(0, 0, 0, 0)", "1"]);
      expect(look.overlaps, look.name).toEqual([]);
    }
  }
}, 90_000);

it("u2237_fill_and_restore_refit_once", async () => {
  await open();

  const header = () => page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('.bubble:not([hidden]) .bubble-state').getBoundingClientRect(); return { x: r.right + 4, y: r.y + r.height / 2 }; }`);
  const sizes = () => page.call<number>(`() => window.__fake.app.calls.filter((call) => call.method === 'terminal.resize').length`);
  const settle = () => page.call(`() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);

  await settle();

  const start = await sizes();

  const at = await header();

  await page.doubleClick(at.x, at.y);
  await settle();
  expect(await sizes()).toBe(start + 1);

  const again = await header();

  await page.doubleClick(again.x, again.y);
  await settle();
  expect(await sizes()).toBe(start + 2);
  expect(await page.call<number>(`() => window.__fake.app.calls.filter((call) => call.method === 'terminal.write').length`)).toBe(0);
}, 90_000);

import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage, FULLSCREEN } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U523 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const open = async (width: number, scheme: "light" | "dark", contrast?: "more") => {
  await page.scheme(scheme, contrast);
  await page.load("/harness.html?seed=door-stopped", width, FULLSCREEN.height);
  await page.until(`() => document.querySelector('.terminal-new')`);
  await page.call(`() => document.querySelector('.terminal-new').click()`);
  await page.until(`() => document.querySelector('.bubble:not([hidden]) .xterm-screen')`);
};

const surface = `() => {
  const b = document.querySelector('.bubble:not([hidden])');
  const s = getComputedStyle(b);
  const probe = document.createElement('div');
  probe.style.boxShadow = 'var(--shadow-drawer)';
  document.body.append(probe);
  const drawer = getComputedStyle(probe).boxShadow;
  probe.remove();
  return {radius:s.borderTopLeftRadius, borders:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth], shadowIsDrawer:s.boxShadow === drawer && drawer !== 'none', background:s.backgroundColor, backdrop:s.backdropFilter, opacity:s.opacity, overflow:s.overflow,
    viewport:getComputedStyle(b.querySelector('.xterm-viewport')).backgroundColor, ground:(() => { const p = document.createElement('div'); p.style.backgroundColor = 'var(--ground)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; })()};
}`;

it("u523_panel_uses_radius_shadow_and_opaque_ground", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await open(1280, scheme);
    const read = await page.call<{ radius: string; borders: string[]; shadowIsDrawer: boolean; background: string; backdrop: string; opacity: string; overflow: string; viewport: string; ground: string }>(surface);

    expect(read.radius, scheme).toBe("12px");
    expect(read.borders, scheme).toEqual(["0px", "0px", "0px", "0px"]);
    expect(read.shadowIsDrawer, scheme).toBe(true);
    expect(read.background, scheme).toMatch(/^rgb\(/);
    expect(read.backdrop, scheme).toBe("none");
    expect(read.opacity, scheme).toBe("1");
    expect(read.overflow, scheme).toBe("hidden");
    expect(read.viewport, `${scheme} the emulator viewport shows the ground, not xterm's black`).toBe(read.ground);
  }
}, 90_000);

const insets = `() => {
  const bubble = document.querySelector('.bubble:not([hidden])');
  const box = bubble.getBoundingClientRect();
  const header = bubble.querySelector('.bubble-header').getBoundingClientRect();
  const body = bubble.querySelector('.bubble-body').getBoundingClientRect();
  const xterm = bubble.querySelector('.xterm').getBoundingClientRect();
  const centres = [...bubble.querySelectorAll('.bubble-name,.bubble-state,.bubble-header button')].map(e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; });
  const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-3')) * (getComputedStyle(document.documentElement).getPropertyValue('--space-3').endsWith('rem') ? 16 : 1);
  return {inset, left:header.left - box.left, right:box.right - header.right, bodyLeft:body.left - box.left, bodyRight:box.right - body.right, top:header.top - box.top, bottom:box.bottom - xterm.bottom,
    xtermWithinBody:xterm.left >= body.left - 1 && xterm.right <= body.right + 1, spread:Math.max(...centres) - Math.min(...centres), headerHeight:header.height, single:new Set(centres.map(c => Math.round(c))).size};
}`;

it("u523_header_and_terminal_share_one_inset", async () => {
  for (const width of [FULLSCREEN.width]) {
    await open(width, "light");
    await page.call(`() => document.querySelector('.bubble-header').focus()`);

    for (const size of ["default", "minimum"]) {
      if (size === "minimum") {
        for (let step = 0; step < 40; step++) {
          await page.press("ArrowLeft", "ArrowLeft", 8);
          await page.press("ArrowUp", "ArrowUp", 8);
        }

        await page.call(`() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))`);
      }

      const read = await page.call<{ inset: number; left: number; right: number; bodyLeft: number; bodyRight: number; top: number; bottom: number; xtermWithinBody: boolean; spread: number; headerHeight: number }>(insets);
      const at = `${width} ${size}`;

      expect(read.left, at).toBeCloseTo(read.inset, 0);
      expect(read.right, at).toBeCloseTo(read.inset, 0);
      expect(Math.abs(read.bodyLeft - read.left), at).toBeLessThanOrEqual(1);
      expect(Math.abs(read.bodyRight - read.right), at).toBeLessThanOrEqual(1);
      expect(read.top, at).toBeCloseTo(read.inset, 0);
      expect(Math.abs(read.bottom - read.inset), `${at} bottom inset`).toBeLessThanOrEqual(1);
      expect(read.xtermWithinBody, at).toBe(true);
      expect(read.spread, `${at} header content shares one vertical centre`).toBeLessThanOrEqual(1);
    }
  }
}, 120_000);

it("u523_focus_and_terminal_paint_fit_the_panel", async () => {
  await open(1280, "light");
  await page.call(`() => document.querySelector('.bubble-header').focus()`);
  await page.press("Tab", "Tab");
  await page.press("Tab", "Tab");

  const read = await page.call<{ focused: string | null; ring: string; ringInside: boolean; paintInside: boolean }>(`() => {
    const bubble = document.querySelector('.bubble:not([hidden])').getBoundingClientRect();
    const active = document.activeElement;
    const s = getComputedStyle(active);
    const r = active.getBoundingClientRect();
    const grow = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
    const xterm = document.querySelector('.bubble:not([hidden]) .xterm').getBoundingClientRect();
    return {focused:active.getAttribute('aria-label'), ring:s.outlineStyle, ringInside:r.left - grow >= bubble.left && r.right + grow <= bubble.right && r.top - grow >= bubble.top && r.bottom + grow <= bubble.bottom,
      paintInside:xterm.left >= bubble.left && xterm.right <= bubble.right && xterm.top >= bubble.top && xterm.bottom <= bubble.bottom};
  }`);

  expect(read.focused).toBe("Close");
  expect(read.ring).not.toBe("none");
  expect(read.ringInside).toBe(true);
  expect(read.paintInside).toBe(true);
}, 60_000);

it("u523_header_buttons_have_ink_feedback_and_visible_focus", async () => {
  await open(1280, "light");

  const rest = await page.call<{ x: number; y: number; w: number; h: number; color: string }>(`() => { const b = document.querySelector('.bubble:not([hidden]) .bubble-header button[aria-label="Close"]'); const r = b.getBoundingClientRect(); return {x:r.x + r.width / 2, y:r.y + r.height / 2, w:r.width, h:r.height, color:getComputedStyle(b).color}; }`);
  const boxless = `() => { const s = getComputedStyle(document.querySelector('.bubble:not([hidden]) .bubble-header button[aria-label="Close"]')); return {bg:s.backgroundColor, image:s.backgroundImage, shadow:s.boxShadow, border:s.borderTopWidth, color:s.color}; }`;

  expect(rest.w).toBeGreaterThanOrEqual(24);
  expect(rest.h).toBeGreaterThanOrEqual(24);
  await page.hover(rest.x, rest.y);

  const hovered = await page.call<{ bg: string; image: string; shadow: string; border: string; color: string }>(boxless);

  expect(hovered).toMatchObject({ bg: "rgba(0, 0, 0, 0)", image: "none", shadow: "none", border: "0px" });
  expect(hovered.color).not.toBe(rest.color);
  await page.pointer("down", rest.x, rest.y);
  expect(await page.call(boxless)).toMatchObject({ bg: "rgba(0, 0, 0, 0)", image: "none", shadow: "none", border: "0px" });
  await page.pointer("up", 0, 0);
}, 60_000);

it("u523_rendered_checks_and_opaque_contrast", async () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const contrast of [undefined, "more"] as const) {
      await open(1280, scheme, contrast);
      const checks = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

      for (const [id, check] of Object.entries(checks)) expect(check.status, `${scheme} ${contrast ?? "normal"} ${id}`).toBe("pass");
    }
  }
}, 120_000);

it("u523_only_the_bubble_surface_exception_changes", async () => {
  await open(1280, "light");

  const shadowed = await page.call<string[]>(`() => [...document.querySelectorAll('.rail, .rail *, .pane, .pane *, .bubble-dock, .bubble-dock *')].filter(e => getComputedStyle(e).boxShadow !== 'none' || parseFloat(getComputedStyle(e).borderTopLeftRadius) > 12).map(e => e.className)`);

  expect(shadowed).toEqual([]);
  expect((await page.call<Record<string, { status: string }>>(`() => window.__checks()`))["D8"]?.status).toBe("pass");
}, 60_000);

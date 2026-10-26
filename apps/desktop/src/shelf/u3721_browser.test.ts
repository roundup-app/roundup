import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

it("u3721_overlay_mode_has_no_maximise_button_and_m_does_nothing", async () => {
  await openShelf("tree-40", 288, 360, 800, "dark");
  expect(await evaluate("document.querySelector('.shelf-controls button[aria-label=Maximise]') === null")).toBe(true);
  await evaluate(`document.querySelector('.shelf button').focus()`);
  await browser("press", "m");
  expect(await evaluate("document.querySelector('.window').dataset.shelfMaximised")).toBe("false");
}, 60_000);

it("u3721_restore_keeps_terminal_fitting_operable", async () => {
  await openShelf("agents-10", 288, 360, 1512, "dark");
  await evaluate(`document.querySelector('.rail [data-id="agent-4"] .name').click()`);
  await browser("wait", ".xterm-screen");
  await settle();
  await browser("click", '.shelf-controls button[aria-label="Maximise"]');
  await settle();
  await browser("click", '.shelf-controls button[aria-label="Restore"]');
  await settle();
  const before = await evaluate<number>("window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length");

  await evaluate(`document.querySelector('.rail-edge').focus()`);
  await browser("press", "ArrowRight");
  await settle();
  await browser("wait", "--fn", `window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length > ${before}`);
  expect(await evaluate<number>("window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length")).toBeGreaterThan(before);
}, 90_000);

it("u4279b_maximised_shelf_excludes_covered_controls", async () => {
  await openShelf("tree-40", 288, 360, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await browser("wait", ".ask-input");
  const targets = ".ask-input, .overview-attention button";
  const before = await evaluate<{ points: { x: number; y: number }[]; calls: number }>(`(() => {
    const targets = [...document.querySelectorAll('${targets}')];
    return { points: targets.map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }), calls: window.__fake.app.calls.length };
  })()`);
  expect(before.points.length).toBeGreaterThan(1);
  expect(await evaluate(`document.querySelector('.ask-input').checkVisibility({ visibilityProperty: true })`)).toBe(true);
  await browser("click", ".shelf-controls button[aria-label=Maximise]");
  await settle();
  expect(await evaluate(`[...document.querySelectorAll('${targets}')].every(e => e.closest('[inert]') || !e.checkVisibility({ visibilityProperty: true }))`)).toBe(true);
  const calls = await evaluate<number>("window.__fake.app.calls.length");

  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 12; i++) {
      await browser("press", key);
      await settle();
      expect(await evaluate("!!document.activeElement.closest('.centre')")).toBe(false);
    }
  }
  for (const point of before.points) {
    await browser("mouse", "move", String(point.x), String(point.y));
    await browser("mouse", "down");
    await browser("mouse", "up");
    await settle();
  }
  expect(await evaluate("!!document.activeElement.closest('.centre')")).toBe(false);
  expect(await evaluate("window.__fake.app.calls.length")).toBe(calls);
  expect(await evaluate(`(() => { const r = document.querySelector('[data-layout-root]').getBoundingClientRect(); return Math.abs(r.top) <= 1 && Math.abs(r.bottom - innerHeight) <= 1; })()`)).toBe(true);
}, 90_000);

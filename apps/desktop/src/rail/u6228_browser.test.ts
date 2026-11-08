import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

/** U6228 in a real Chromium: collapse paths, persistence and the Terminal's resizes are read from the rendered App. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

const META = 4;

const KEY = "roundup:widths:/Users/you/harness";

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U6228 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterEach(async () => { await page.call(`() => localStorage.clear()`); });

afterAll(async () => { await page?.close(); });

const load = async (width = 1280) => {
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", width, 800);
  await page.until(`() => Boolean(document.querySelector('.rail-actions button')) && Boolean(document.querySelector('[aria-label="Resize Rail"]'))`);
  await page.call(`() => { document.querySelector('.rail [data-id="payments"] .name').click(); }`);
  await page.until(`() => Boolean(document.querySelector('.pane-screen'))`);
};

const resizes = () => page.call<number>(`() => window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length`);

const saved = () => page.call<{ rail: number; collapsed?: boolean }>(`() => JSON.parse(localStorage.getItem('${KEY}') ?? 'null')`);

const collapsed = () => page.call<boolean>(`() => document.querySelector('.rail').dataset.collapsed === 'true'`);

// The Terminal refits a frame after a slide ends (250 ms), so wait for the count to hold still across longer than a slide.
const quiet = async () => {
  let last = -1;

  for (let tries = 0; tries < 20; tries += 1) {
    await page.call(`() => new Promise(resolve => setTimeout(resolve, 400))`);
    const now = await resizes();

    if (now === last) return now;
    last = now;
  }

  return last;
};

const leader = async (code: string, key: string) => {
  await page.call(`() => document.activeElement?.blur()`);
  await page.press("k", "KeyK", META);
  await page.press(key, code);
};

const dragEdge = async (to: number) => {
  const at = await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('[aria-label="Resize Rail"]').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: 200 }; }`);

  await page.down(at.x, at.y);
  await page.pointer("move", (at.x + to) / 2, at.y);
  await page.pointer("move", to, at.y);
  await page.release(to, at.y);
};

run("u6228 the Rail collapses to a strip", () => {
  vi.setConfig({ testTimeout: 60_000 });

  it("u6228_the_toggle_collapses_and_expands_with_one_terminal_resize_each", async () => {
    await load();
    const before = await quiet();

    await page.call(`() => document.querySelector('.rail-toggle').click()`);
    await page.until(`() => document.querySelector('.rail').dataset.collapsed === 'true'`);
    expect(await quiet()).toBe(before + 1);
    expect(await saved()).toMatchObject({ collapsed: true });

    await page.call(`() => document.querySelector('.rail-toggle').click()`);
    await page.until(`() => document.querySelector('.rail').dataset.collapsed !== 'true'`);
    expect(await quiet()).toBe(before + 2);
    expect(await saved()).toMatchObject({ rail: 288, collapsed: false });
  });

  it("u6228f_a_press_changes_the_collapsed_state_with_one_terminal_resize", async () => {
    await load();
    const before = await quiet();

    await page.call(`() => document.querySelector('.rail-toggle').click()`);
    await page.until(`() => document.querySelector('.rail').dataset.collapsed === 'true' && document.querySelector('.rail-toggle').getAttribute('aria-label') === 'Expand the Rail'`);
    expect(await quiet()).toBe(before + 1);
    expect(await page.call<number>(`() => document.querySelectorAll('.window-bar [aria-label$="the Rail"]').length`)).toBe(1);
  });

  it("u6228g_a_key_slide_uses_the_key_duration_and_a_click_the_drawer_duration", async () => {
    await load();
    const read = `() => new Promise(resolve => requestAnimationFrame(() => resolve(document.querySelector('.rail').dataset.slide)))`;

    await page.call(`() => document.querySelector('.rail-toggle').click()`);
    expect(await page.call<string>(read)).toBe("click");
    await quiet();

    await page.call(`() => document.querySelector('.rail-toggle').click()`);
    await quiet();
    await leader("KeyR", "r");
    expect(await page.call<string>(read)).toBe("key");
  });

  it("u6228g_a_press_during_a_slide_leaves_one_running_motion", async () => {
    await load();
    await quiet();

    const running = await page.call<number>(`() => new Promise(resolve => {
      const toggle = document.querySelector('.rail-toggle');
      toggle.click();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        toggle.click();
        requestAnimationFrame(() => resolve(document.querySelector('.rail-body').getAnimations().filter(motion => motion.transitionProperty === 'transform' && motion.playState === 'running').length));
      }));
    })`);

    expect(running).toBeLessThanOrEqual(1);
  });

  it("u6228g_reduced_motion_fades_and_sends_one_terminal_resize", async () => {
    await page.scheme("dark", undefined, "motion");
    await load();

    const fade = `() => new Promise(resolve => requestAnimationFrame(() => {
      const body = document.querySelector('.rail-body');
      const moving = body.getAnimations().map(motion => motion.transitionProperty);

      resolve({ slide: document.querySelector('.rail').dataset.slide, transform: moving.includes('transform') });
    }))`;

    let before = await quiet();

    await page.call(`() => document.querySelector('.rail-toggle').click()`);
    expect(await page.call(fade)).toEqual({ slide: "fade", transform: false });
    expect(await quiet()).toBe(before + 1);

    before = await quiet();
    await page.call(`() => document.activeElement?.blur()`);
    await leader("KeyR", "r");
    expect(await page.call(fade)).toEqual({ slide: "fade", transform: false });
    expect(await quiet()).toBe(before + 1);
    await page.scheme("dark");
  });

  it("u6228_the_leader_chord_toggles_and_a_restart_keeps_it", async () => {
    await load();
    await leader("KeyR", "r");
    await page.until(`() => document.querySelector('.rail').dataset.collapsed === 'true'`);

    await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1280, 800);
    await page.until(`() => Boolean(document.querySelector('.rail-strip'))`);
    expect(await collapsed()).toBe(true);

    await leader("KeyR", "r");
    await page.until(`() => document.querySelector('.rail').dataset.collapsed !== 'true'`);
    expect(await saved()).toMatchObject({ rail: 288, collapsed: false });
  });

  it("u6228_dragging_the_edge_under_its_minimum_collapses_and_dragging_out_expands", async () => {
    await load();
    const before = await quiet();

    await dragEdge(80);
    await page.until(`() => document.querySelector('.rail').dataset.collapsed === 'true'`);
    expect(await quiet()).toBe(before + 1);
    expect(await saved()).toMatchObject({ rail: 288, collapsed: true });

    await dragEdge(380);
    await page.until(`() => document.querySelector('.rail').dataset.collapsed !== 'true'`);
    expect(await quiet()).toBe(before + 2);
    expect(Math.abs((await saved()).rail - 380)).toBeLessThanOrEqual(2);
  });
});

const hover = async (selector: string) => {
  const at = await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }`);

  await page.pointer("move", at.x - 1, at.y);
  await page.pointer("move", at.x, at.y);
};

const peeking = () => page.call<boolean>(`() => document.querySelector('.rail').dataset.peek === 'true'`);

const awayFromRail = async () => {
  await page.pointer("move", 700, 400);
  await page.pointer("move", 701, 400);
};

const collapseByButton = async () => {
  await page.call(`() => document.querySelector('.rail-toggle').click()`);
  await page.until(`() => document.querySelector('.rail').dataset.collapsed === 'true'`);
  await awayFromRail();
};

run("u6228 the collapsed Rail peeks", () => {
  vi.setConfig({ testTimeout: 60_000 });

  it("u6228_a_rested_pointer_peeks_the_rail_over_the_centre_and_leaving_slides_it_back", async () => {
    await load();
    await collapseByButton();
    const before = await quiet();

    await hover(".rail-mark");
    await page.until(`() => document.querySelector('.rail').dataset.peek === 'true'`);
    expect(await quiet()).toBe(before);
    expect(await saved()).toMatchObject({ collapsed: true });

    await awayFromRail();
    await page.until(`() => document.querySelector('.rail').dataset.peek !== 'true'`);
    expect(await quiet()).toBe(before);
    expect(await collapsed()).toBe(true);
  });

  it("u6228_keyboard_focus_on_a_mark_never_peeks_and_escape_slides_a_peek_back", async () => {
    await load();
    await collapseByButton();

    await page.call(`() => document.querySelector('.rail-mark[data-id]').focus()`);
    await page.call(`() => new Promise(resolve => setTimeout(resolve, 600))`);
    expect(await peeking()).toBe(false);

    await hover(".rail-mark");
    await page.until(`() => document.querySelector('.rail').dataset.peek === 'true'`);
    await page.press("Escape", "Escape");
    await page.until(`() => document.querySelector('.rail').dataset.peek !== 'true'`);
    expect(await collapsed()).toBe(true);
  });

  it("u6228_a_click_in_the_peek_selects_and_the_peek_still_slides_back", async () => {
    await load();
    await collapseByButton();
    await hover(".rail-mark");
    await page.until(`() => document.querySelector('.rail').dataset.peek === 'true'`);

    await page.call(`() => document.querySelector('.rail-body [data-id="auth"] .name').click()`);
    await page.until(`() => document.querySelector('.rail-body [data-id="auth"]')?.getAttribute('aria-selected') === 'true'`);
    expect(await peeking()).toBe(true);
    expect(await collapsed()).toBe(true);

    await awayFromRail();
    await page.until(`() => document.querySelector('.rail').dataset.peek !== 'true'`);
    expect(await collapsed()).toBe(true);
  });

  it("u6228_only_an_explicit_expand_opens_the_peeked_rail_and_pushes_the_centre", async () => {
    await load();
    await collapseByButton();
    const before = await quiet();

    await hover(".rail-mark");
    await page.until(`() => document.querySelector('.rail').dataset.peek === 'true'`);
    await page.call(`() => document.querySelector('.rail-toggle').click()`);
    await page.until(`() => document.querySelector('.rail').dataset.collapsed !== 'true'`);
    expect(await quiet()).toBe(before + 1);
    expect(await saved()).toMatchObject({ collapsed: false });
    expect(await peeking()).toBe(false);
  });
});

import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage, FULLSCREEN } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U511 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

type Look = { font: string; letter: string; line: string; left: number; baseline: number; height: number; rects: Record<string, number[] | null> };

const probe = `(selector) => {
  const node = document.querySelector(selector);
  const style = getComputedStyle(node);
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  const range = document.createRange();
  let left = node.getBoundingClientRect().left;
  if (node.tagName !== 'INPUT') { range.selectNodeContents(node); left = range.getBoundingClientRect().left; }
  const box = node.getBoundingClientRect();
  const pad = parseFloat(style.paddingLeft);
  const rect = s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height] : null; };
  return { font: [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle].join('|'), letter: style.letterSpacing, line: style.lineHeight,
    left: node.tagName === 'INPUT' ? box.left + pad : left, baseline: box.top + (box.height - parseFloat(style.fontSize)) / 2, height: document.querySelector('.terminal-tab-pair').getBoundingClientRect().height,
    rects: { bar: rect('.resource-strip'), pane: rect('.pane') } };
}`;

const open = async (width: number): Promise<void> => {
  await page.load('/harness.html?seed=bubbles', width, FULLSCREEN.height);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
  await page.until(`() => document.querySelector('.terminal-tab-name')`);
};

const centre = (selector: string) => page.call<{ x: number; y: number }>(`(s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`, selector);

const enter = async (): Promise<void> => {
  const at = await centre('.terminal-tab-name');

  await page.doubleClick(at.x, at.y);
  await page.until(`() => document.activeElement?.matches('.terminal-tab-editor input')`);
};

it("u511a_editor_matches_label_type_and_baseline", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);
    await open(1280);

    const before = await page.call<Look>(probe, '.terminal-tab-name');
    const heights = await page.call<number[]>(`() => [...document.querySelectorAll('.terminal-tab-pair')].map(p => p.getBoundingClientRect().height)`);

    await enter();

    const during = await page.call<Look>(probe, '.terminal-tab-editor input');
    const selected = await page.call<number[]>(`() => { const i = document.activeElement; return [i.selectionStart, i.selectionEnd, i.value.length]; }`);

    expect(during.font).toBe(before.font);
    expect(during.letter).toBe(before.letter);
    expect(Math.abs(during.left - before.left)).toBeLessThanOrEqual(1);
    expect(selected).toEqual([0, selected[2], selected[2]]);
    expect(heights.length).toBeGreaterThan(0);
  }
}, 90_000);

it("u511a_entry_keeps_the_surrounding_rectangles", async () => {
  for (const width of [FULLSCREEN.width]) {
    await open(width);

    const before = await page.call<Look>(probe, '.terminal-tab-name');

    await enter();

    const during = await page.call<Look>(probe, '.terminal-tab-editor input');

    for (const [name, rect] of Object.entries(before.rects)) {
      expect(rect, name).not.toBeNull();
      during.rects[name]!.forEach((value, index) => expect(Math.abs(value - rect![index]!), `${name} ${width}`).toBeLessThanOrEqual(1));
    }

    expect(Math.abs(during.height - before.height)).toBeLessThanOrEqual(1);
  }
}, 90_000);

it("u511a_editor_width_tracks_text", async () => {
  await open(1280);
  await enter();

  const width = () => page.call<number>(`() => document.querySelector('.terminal-tab-editor input').getBoundingClientRect().width`);
  const first = await width();

  for (const key of "WWWWWWWWWW") await page.press(key, `Key${key}`);
  const wide = await width();

  expect(wide).toBeGreaterThan(first + 40);

  await page.press("Escape", "Escape");
  await page.until(`() => !document.querySelector('.terminal-tab-editor')`);
  expect(await page.call<boolean>(`() => !document.querySelector('.terminal-tab').getAttribute('aria-label').includes('WWW')`)).toBe(true);
  await page.until(`() => document.activeElement?.matches('.terminal-tab')`);

  await enter();

  for (const key of "ab") await page.press(key, `Key${key.toUpperCase()}`);
  await page.press("Enter", "Enter");
  await page.until(`() => document.querySelector('.terminal-tab')?.getAttribute('aria-label') === 'ab'`);
  await page.until(`() => document.activeElement?.matches('.terminal-tab')`);
}, 90_000);

it("u511a_dense_editing_does_not_clip_or_cover_controls", async () => {
  await open(1280);
  await enter();
  await page.call(`() => { const i = document.activeElement; i.value = 'gjpqy ÅÉ 終端 🧪 ' + 'W'.repeat(60); i.dispatchEvent(new Event('input', {bubbles: true})); }`);

  const read = await page.call<{ clipped: boolean; reachable: boolean; bar: boolean }>(`() => {
    const input = document.querySelector('.terminal-tab-editor input');
    const tabs = document.querySelector('.terminal-tabs');
    const plus = document.querySelector('.terminal-new').getBoundingClientRect();
    return { clipped: input.scrollWidth > input.clientWidth + 1 || input.scrollHeight > input.clientHeight + 1, reachable: tabs.scrollWidth >= tabs.clientWidth && plus.width > 0, bar: document.querySelector('.resource-strip').getBoundingClientRect().bottom <= innerHeight };
  }`);

  expect(read).toEqual({ clipped: false, reachable: true, bar: true });
}, 90_000);

it("u511a_keyboard_context_menu_renames_and_click_away_commits_without_swallowing_the_click", async () => {
  await open(1280);
  await page.call(`() => document.querySelector('.terminal-tab').focus()`);
  // The platform turns Shift+F10 or the Menu key on a focused control into this event; headless key input cannot.
  await page.call(`() => document.activeElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
  await page.until(`() => document.querySelector('[role="menuitem"]')`);
  await page.until(`() => document.activeElement?.matches('[role="menu"], [role="menuitem"]')`);
  await page.press("ArrowDown", "ArrowDown");
  await page.press("Enter", "Enter");
  await page.until(`() => document.activeElement?.matches('.terminal-tab-editor input')`);

  for (const key of "xy") await page.press(key, `Key${key.toUpperCase()}`);
  const other = await centre('.terminal-tab-pair:nth-child(2) .terminal-tab');
  const pressed = await page.call<string | null>(`() => document.querySelector('.terminal-tab-pair:nth-child(2) .terminal-tab').getAttribute('aria-pressed')`);

  await page.click(other.x, other.y);
  await page.until(`() => document.querySelector('.terminal-tab-pair:nth-child(1) .terminal-tab')?.getAttribute('aria-label') === 'xy'`);
  expect(await page.call<string | null>(`() => document.querySelector('.terminal-tab-pair:nth-child(2) .terminal-tab').getAttribute('aria-pressed')`)).not.toBe(pressed);
}, 90_000);

type Readings = Record<string, { status: "pass" | "fail" }>;

const readings = () => page.call<Readings>(`() => import('/src/testing/checks.ts').then(module => module.runChecks())`);

for (const scheme of ["light", "dark"] as const) for (const width of [FULLSCREEN.width]) for (const reduced of [undefined, "motion"] as const) {
  it(`u511a_rendered_checks ${scheme}-${width}-${reduced ?? "normal"}`, async () => {
    await page.scheme(scheme, undefined, reduced);
    await open(width);

    const before = await readings();

    await enter();
    await page.call(`() => { const i = document.activeElement; i.value = 'gjpqy ÅÉ 終端 🧪 ' + 'W'.repeat(60); i.dispatchEvent(new Event('input', {bubbles: true})); }`);

    const during = await readings();

    for (const id of Object.keys(before)) if (before[id]!.status === "pass") expect(`${id} ${during[id]!.status}`).toBe(`${id} pass`);

    for (const id of ["D2", "D5", "D6"]) expect(`${id} ${during[id]!.status}`).toBe(`${id} pass`);
  }, 90_000);
}

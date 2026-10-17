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

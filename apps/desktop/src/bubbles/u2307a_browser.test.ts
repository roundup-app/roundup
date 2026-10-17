import { afterAll, beforeAll, expect, it } from "vitest";
import type { ChromePage } from "../testing/chromePage";
import { centreOf, openBubblePage, showBubble } from "../testing/u2307Browser";

let page: ChromePage;

beforeAll(async () => {
  page = await openBubblePage();
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const state = () =>
  page.call<{ open: boolean }>(
    `() => ({ open: Boolean(document.querySelector('.bubble:not([hidden])')) })`,
  );

it("u2307a_browser_an_outside_press_on_the_rail_the_door_terminal_and_the_header_minimises_and_reaches_the_target", async () => {
  for (const target of [".rail-row", ".pane-screen", ".window-title"]) {
    await showBubble(page);

    // The Door terminal is reached below the bubble, at its trailing corner.
    const at =
      target === ".pane-screen"
        ? await page.call<{ x: number; y: number }>(
            `() => { const r = document.querySelector('.pane-screen').getBoundingClientRect(); return { x: r.right - 20, y: r.bottom - 20 }; }`,
          )
        : await centreOf(page, target);

    await page.click(at.x, at.y);
    await page.until(`() => !document.querySelector('.bubble:not([hidden])')`);
    expect((await state()).open, target).toBe(false);
    // The press reached its target: focus or selection moved off the minimised bubble.
    expect(
      await page.call<boolean>(
        `() => !document.activeElement?.closest('.bubble')`,
      ),
      target,
    ).toBe(true);
  }
}, 120_000);

it("u2307a_browser_escape_stays_in_the_terminal", async () => {
  await showBubble(page);
  await page.call(
    `() => document.querySelector('.bubble:not([hidden]) .xterm-helper-textarea, .bubble:not([hidden]) [data-terminal]').focus()`,
  );
  await page.press("Escape", "Escape");
  expect((await state()).open).toBe(true);
  expect(
    await page.call<boolean>(
      `() => Boolean(document.activeElement?.closest('.bubble'))`,
    ),
  ).toBe(true);
}, 60_000);

it("u2307a_browser_a_press_on_the_band_under_the_bar_and_on_the_inset_keeps_the_bubble_open", async () => {
  await showBubble(page);

  const box = await page.call<{ left: number; top: number; right: number; bottom: number; bar: number; body: { left: number; right: number; top: number; bottom: number } }>(`() => {
    const rect = (selector) => document.querySelector('.bubble:not([hidden]) ' + selector).getBoundingClientRect();
    const b = document.querySelector('.bubble:not([hidden])').getBoundingClientRect();
    const body = rect('.bubble-body');

    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, bar: rect('.bubble-header').bottom, body: { left: body.left, right: body.right, top: body.top, bottom: body.bottom } };
  }`);

  const middle = (box.left + box.right) / 2;
  const centre = (box.top + box.bottom) / 2;
  const points = { bar: [middle, box.top + 2], left: [box.left + 1, centre], right: [box.right - 1, centre], bottom: [middle, box.bottom - 1], terminal: [middle, (box.body.top + box.body.bottom) / 2] } as const;

  for (const [name, [x, y]] of Object.entries(points)) {
    await page.click(x!, y!);
    expect((await state()).open, name).toBe(true);
  }
}, 60_000);

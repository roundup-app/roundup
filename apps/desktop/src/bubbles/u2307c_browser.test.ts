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

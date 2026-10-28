import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2232 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const strip = async (scheme: "light" | "dark") => {
  await page.scheme(scheme);
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tabs-8", 1512, 950);
  await page.until(`() => document.querySelectorAll('.project-tab').length === 8`);
};

it("u2234_a_rename_field_opens_without_selecting_the_tab", async () => {
  const surfaces = [
    { surface: "strip", tab: ".project-tab", name: ".tab-name", field: ".tab-rename" },
  ] as const;

  for (const { surface, tab, name, field } of surfaces) for (const state of ["selected", "rest"] as const) {
    await strip("light");

    // The first tab in this state, scrolled into reach; the point is only where the click lands.
    await page.until(`() => document.querySelector(${JSON.stringify(`${tab}[data-selected=${state === "selected"}]`)})`);

    const at = await page.call<{ x: number; y: number }>(`(tab, name, selected) => { const node = document.querySelector(tab + '[data-selected=' + selected + ']'); node.id = 'renamed'; node.scrollIntoView({ inline: 'center' }); const r = node.querySelector(name).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`, tab, name, String(state === "selected"));

    // F2 on a Project tab's name renames without selecting it; a double click would select it first.
    if (surface === "strip" && state === "rest") {
      await page.call(`() => document.querySelector('#renamed .tab-name-button').focus()`);
      await page.press("F2", "F2");
    } else await page.doubleClick(at.x, at.y);

    await page.until(`() => document.activeElement?.matches(${JSON.stringify(field)})`);

    expect(await page.call<string | null>(`() => document.querySelector('#renamed').getAttribute('data-selected')`), `${surface} ${state}`).toBe(String(state === "selected"));
  }
}, 60_000);

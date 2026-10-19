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
  await page.load("/harness.html?seed=tabs-8", 1512, 950);
  await page.until(`() => document.querySelectorAll('.project-tab').length === 8`);
};

const runs = async (scheme: "light" | "dark", contrast?: "more", agent: "runner" | "first-workstream" | "dense" = "runner") => {
  await page.scheme(scheme, contrast);
  await page.load("/harness.html?seed=bubbles", 1512, 950);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`(id) => document.querySelector('[data-id="' + id + '"]').click()`, agent);
  await page.until(`() => document.querySelectorAll('.terminal-tab-pair').length > ${agent === "first-workstream" ? 0 : 1}`);
  await page.call(`() => { if (!document.querySelector('.terminal-tab-pair[data-selected=true]')) document.querySelector('.terminal-tab').click(); }`);
  await page.until(`() => document.querySelector('.terminal-tab-pair[data-selected=true]')`);
};

// U2770's real-input observer owns pointer rings and tab-name/Open-folder keyboard rings.
it("u2233_close_and_add_keep_the_keyboard_ring", async () => {
  for (const surface of ["strip", "runs"] as const) {
    if (surface === "strip") await strip("light");
    else await runs("light");

    // The tab reveals its sibling close control while focus is within the pair.
    await page.call(`(control) => document.querySelector(control).focus()`, surface === "strip" ? ".project-tab .tab-name-button" : ".terminal-tab");
    await page.press("Tab", "Tab");

    const controls = surface === "strip"
      ? [".project-tab .tab-close"]
      : [".terminal-tab-pair > button:last-of-type", ".terminal-new"];

    for (const control of controls) {
      await page.call(`(control) => document.querySelector(control).focus()`, control);
      expect(await page.call<string>(`() => getComputedStyle(document.activeElement).outlineStyle`), `${surface} ${control}`).toBe("solid");
    }
  }
}, 120_000);

it("u2234_a_rename_field_opens_without_selecting_the_tab", async () => {
  const surfaces = [
    { surface: "strip", tab: ".project-tab", name: ".tab-name", field: ".tab-rename" },
    { surface: "runs", tab: ".terminal-tab-pair", name: ".terminal-tab-name", field: ".terminal-tab-editor input" },
  ] as const;

  for (const { surface, tab, name, field } of surfaces) for (const state of ["selected", "rest"] as const) {
    if (surface === "strip") await strip("light");
    else await runs("light");

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
}, 120_000);

it("u2235_flat_tabs_scroll_inside_the_pane_and_stay_reachable", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await runs(scheme);

    const count = await page.call<number>(`() => document.querySelectorAll('.terminal-tab-pair').length`);

    for (let index = 0; index < count; index++) {
      // A tab's name arrives after its pair mounts; each tab takes keyboard focus and its full name is its accessible name.
      await page.until(`() => Boolean(document.querySelectorAll('.terminal-tab-pair')[${index}]?.querySelector('.terminal-tab')?.getAttribute('aria-label'))`);
      await page.call(`(i) => document.querySelectorAll('.terminal-tab-pair')[i].querySelector('.terminal-tab').focus()`, index);

      const reading = await page.call<{ focused: boolean; named: boolean }>(`(i) => {
        const tab = document.querySelectorAll('.terminal-tab-pair')[i].querySelector('.terminal-tab');
        return { focused: document.activeElement === tab, named: tab.getAttribute('aria-label') === tab.querySelector('.terminal-tab-name').textContent && tab.getAttribute('aria-label') !== '' };
      }`, index);

      expect(reading, `${scheme} ${index}`).toEqual({ focused: true, named: true });
    }
  }
}, 240_000);

it("u2235_a_cut_tab_name_is_shown_by_the_shared_tooltip", async () => {
  await runs("light", undefined, "dense");

  // One Run is named with sixty characters, so its tab cuts the name once the name has arrived.
  const long = `.terminal-tab[aria-label^="a-run-named"]`;

  await page.until(`() => document.querySelector(${JSON.stringify(long)})`);

  const cut = await page.call<{ x: number; y: number; name: string }>(`(long) => { const tab = document.querySelector(long); const name = tab.querySelector('.terminal-tab-name'); const r = name.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: tab.getAttribute('aria-label') }; }`, long);

  expect(await page.call<number>(`() => document.querySelectorAll('.app-tooltip').length`)).toBe(0);

  await page.hover(cut.x, cut.y);
  await page.until(`() => document.querySelector('.app-tooltip')?.textContent === ${JSON.stringify(cut.name)}`);
}, 60_000);

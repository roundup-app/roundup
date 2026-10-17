import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

type Look = { border: string[]; ground: string; radius: string; colour: string; font: string; shadow: string };

const look = `(selector, index) => {
  const node = document.querySelectorAll(selector)[index];
  const s = getComputedStyle(node);
  return { border: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], ground: s.backgroundColor, radius: s.borderRadius, colour: s.color, font: [s.fontFamily, s.fontSize, s.fontWeight].join('|'), shadow: s.boxShadow };
}`;

const token = `(name) => { const p = document.createElement('i'); p.style.color = 'var(' + name + ')'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; }`;

const tokenBg = `(name) => { const p = document.createElement('i'); p.style.backgroundColor = 'var(' + name + ')'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; }`;

const strip = async (scheme: "light" | "dark") => {
  await page.scheme(scheme);
  await page.load("/harness.html?seed=tabs-8", 1280, 800);
  await page.until(`() => document.querySelectorAll('.project-tab').length === 8`);
};

const runs = async (scheme: "light" | "dark", width = 1280) => {
  await page.scheme(scheme);
  await page.load("/harness.html?seed=bubbles", width, 800);
  await page.until(`() => Boolean(window.__fake)`);
  await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
  await page.until(`() => document.querySelectorAll('.terminal-tab-pair').length > 1`);
  await page.call(`() => { if (!document.querySelector('.terminal-tab-pair[data-selected=true]')) document.querySelector('.terminal-tab').click(); }`);
  await page.until(`() => document.querySelector('.terminal-tab-pair[data-selected=true]')`);
};

it("u2231_project_and_terminal_tabs_share_one_component", async () => {
  await runs("light");

  const terminal = await page.call<{ selected: Look; rest: Look }>(`(look) => { const f = eval(look); return { selected: f('.terminal-tab-pair[data-selected=true]', 0), rest: f('.terminal-tab-pair[data-selected=false]', 0) }; }`, look);

  await strip("light");

  const project = await page.call<{ selected: Look; rest: Look }>(`(look) => { const f = eval(look); return { selected: f('.project-tab[data-selected=true]', 0), rest: f('.project-tab[data-selected=false]', 0) }; }`, look);

  for (const state of ["selected", "rest"] as const) {
    expect(project[state].border, state).toEqual(terminal[state].border);
    expect(project[state].ground, state).toBe(terminal[state].ground);
    expect(project[state].radius, state).toBe(terminal[state].radius);
    expect(project[state].colour, state).toBe(terminal[state].colour);
  }
}, 90_000);

it("u2232_the_bar_is_flat_and_square", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await strip(scheme);

    const radii = await page.call<string[]>(`() => ['.strip', '.project-tab', '.strip-add', '.tab-close'].map(s => getComputedStyle(document.querySelector(s)).borderRadius)`);

    expect(radii, scheme).toEqual(["0px", "0px", "0px", "0px"]);
    expect(await page.call<string>(`(t) => getComputedStyle(document.querySelector('.strip')).backgroundColor === eval(t)('--sunken') ? 'ok' : 'no'`, tokenBg)).toBe("ok");
  }
}, 90_000);

it("u2232_the_selected_tab_joins_the_page", async () => {
  for (const scheme of ["light", "dark"] as const) for (const surface of ["strip", "runs"] as const) {
    if (surface === "strip") await strip(scheme);
    else await runs(scheme);

    const selector = surface === "strip" ? ".project-tab" : ".terminal-tab-pair";
    const reading = await page.call<{ look: Look; ground: string; hairline: string }>(`(look, token, selector) => ({ look: eval(look)(selector + '[data-selected=true]', 0), ground: eval(token)('--ground'), hairline: eval(token)('--hairline') })`, look, tokenBg, selector);

    expect(reading.look.ground, scheme + surface).toBe(reading.ground);
    expect(reading.look.border.slice(0, 4), scheme + surface).toEqual(["0px", "1px", "0px", "1px"]);
  }
}, 90_000);

it("u2232_inactive_tabs_have_no_box", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await strip(scheme);

    const rest = await page.call<Look>(`(look) => eval(look)('.project-tab[data-selected=false]', 0)`, look);
    const grey = await page.call<string>(`(t) => eval(t)('--grey')`, token);

    expect(rest.border.slice(0, 4), scheme).toEqual(["0px", "0px", "0px", "0px"]);
    expect(rest.ground, scheme).toBe("rgba(0, 0, 0, 0)");
    expect(rest.shadow, scheme).toBe("none");
    expect(rest.colour, scheme).toBe(grey);
  }
}, 90_000);

it("u2233_hover_moves_only_the_label_colour", async () => {
  await strip("light");

  // The first inactive tab the list shows.
  const at = await page.call<{ x: number; y: number }>(`() => { const list = document.querySelector('.tablist').getBoundingClientRect(); const tab = [...document.querySelectorAll('.project-tab[data-selected=false]')].find(t => { const r = t.getBoundingClientRect(); return r.left >= list.left && r.right <= list.right; }); tab.id = 'hovered'; const r = tab.querySelector('.tab-name-button').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`);
  const read = `(look) => eval(look)('#hovered', 0)`;
  const before = await page.call<Look>(read, look);

  await page.hover(at.x, at.y);

  const text = await page.call<string>(`(t) => eval(t)('--text')`, token);

  await page.until(`() => getComputedStyle(document.querySelector('#hovered')).color === '${text}'`);

  const after = await page.call<Look>(read, look);

  expect({ ...after, colour: "" }).toEqual({ ...before, colour: "" });
}, 90_000);

it("u2233_keyboard_focus_draws_a_ring_and_a_click_does_not", async () => {
  await strip("light");

  const ring = `() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineWidth]; }`;
  const at = await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('.strip-add').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`);

  await page.click(at.x, at.y);
  expect((await page.call<string[]>(ring))[0]).toBe("none");

  await page.press("Tab", "Tab", 8);
  expect(await page.call<boolean>(`() => document.activeElement.matches('[data-flat-tab] button')`)).toBe(true);

  const keyboard = await page.call<{ style: string; width: number }>(`() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; }`);

  expect(keyboard.style).toBe("solid");
  expect(keyboard.width).toBeGreaterThanOrEqual(2);
}, 90_000);

it("u2234_a_rename_field_has_the_tab_type_and_no_border", async () => {
  await runs("light");
  await page.doubleClick(...(await page.call<[number, number]>(`() => { const r = document.querySelector('.terminal-tab-name').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }`)));
  await page.until(`() => document.activeElement?.matches('.terminal-tab-editor input')`);

  const field = await page.call<{ font: string; border: string; radius: string; ground: string; tab: string }>(`() => { const i = document.activeElement; const s = getComputedStyle(i); const t = getComputedStyle(document.querySelector('.terminal-tab-pair')); return { font: [s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight].join('|'), border: s.borderTopWidth, radius: s.borderRadius, ground: s.backgroundColor, tab: [t.fontFamily, t.fontSize, t.fontWeight, t.lineHeight].join('|') }; }`);

  expect(field.font).toBe(field.tab);
  expect(field.border).toBe("0px");
  expect(field.radius).toBe("0px");
  expect(field.ground).toBe("rgba(0, 0, 0, 0)");
}, 90_000);

it("u2235_flat_tabs_scroll_inside_the_pane_and_stay_reachable", async () => {
  for (const width of [1280, 1440]) {
    await runs("light", width);

    const ends = await page.call<{ host: number; values: number; shelf: number }>(`() => ({ host: document.querySelector('.terminal-tabs-host').getBoundingClientRect().right, values: Math.min(...[...document.querySelectorAll('.centre .resource-strip > span')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getBoundingClientRect().left), Infinity), shelf: (() => { const r = document.querySelector('.shelf').getBoundingClientRect(); return r.left > document.querySelector('.terminal-tabs-host').getBoundingClientRect().left ? r.left : Infinity; })() })`);

    expect(ends.host, String(width)).toBeLessThanOrEqual(Math.min(ends.values ?? Infinity, ends.shelf ?? Infinity) + 0.5);

    const count = await page.call<number>(`() => document.querySelectorAll('.terminal-tab-pair').length`);

    for (let index = 0; index < count; index++) {
      await page.call(`(i) => document.querySelectorAll('.terminal-tab')[i].focus()`, index);

      // An overlay Shelf's scrim takes the pointer by design (U371): the hit test runs only where none is drawn.
      const scrim = await page.call<boolean>(`() => document.querySelector('.shelf-scrim') !== null`);

      // The point at the middle of what the region shows of each control hits that control.
      const hit = await page.call<{ tab: boolean; close: boolean; title: boolean }>(`(i) => {
        const host = document.querySelector('.terminal-tabs-host').getBoundingClientRect();
        const tab = document.querySelectorAll('.terminal-tab')[i];
        const close = document.querySelectorAll('.terminal-tab-pair')[i].querySelector('button:last-of-type');
        const at = (e) => { const r = e.getBoundingClientRect(); const left = Math.max(r.left, host.left), right = Math.min(r.right, host.right); return right > left && document.elementFromPoint((left + right) / 2, r.y + r.height / 2); };
        return { tab: tab.contains(at(tab)), close: close.contains(at(close)) || tab.getBoundingClientRect().width > host.width, title: tab.title === tab.getAttribute('aria-label') && tab.title !== '' };
      }`, index);

      expect(hit.title, `${width} ${index}`).toBe(true);

      if (!scrim) expect(hit, `${width} ${index}`).toEqual({ tab: true, close: true, title: true });
    }
  }
}, 120_000);

it("u2235_the_selected_tab_keeps_its_borders_while_scrolled", async () => {
  await runs("light");
  await page.call(`() => { const bar = document.querySelector('.terminal-tabs'); document.querySelector('.terminal-tab[aria-pressed=true]').focus(); bar.scrollLeft = bar.scrollWidth; }`);

  const edges = await page.call<{ left: number; right: number; clipped: boolean }>(`() => {
    const pair = document.querySelector('.terminal-tab-pair[data-selected=true]');
    const s = getComputedStyle(pair);
    const host = document.querySelector('.terminal-tabs-host').getBoundingClientRect();
    const r = pair.getBoundingClientRect();
    return { left: parseFloat(s.borderLeftWidth), right: parseFloat(s.borderRightWidth), clipped: r.left < host.left - 0.5 || r.right > host.right + 0.5 };
  }`);

  expect(edges.left).toBe(1);
  expect(edges.right).toBe(1);
}, 90_000);

it("u2232_the_rule_breaks_only_under_the_selected_tab", async () => {
  await strip("light");

  const row = await page.call<{ rule: string; selectedCovers: boolean; restCovers: boolean; restGround: string; selectedGround: string }>(`() => {
    const header = document.querySelector('.header').getBoundingClientRect();
    const covers = (tab) => tab.getBoundingClientRect().bottom >= header.bottom;
    return { rule: getComputedStyle(document.querySelector('.header')).borderBottomWidth, selectedCovers: covers(document.querySelector('.project-tab[data-selected=true]')), restCovers: covers(document.querySelector('.project-tab[data-selected=false]')), restGround: getComputedStyle(document.querySelector('.project-tab[data-selected=false]')).backgroundColor, selectedGround: getComputedStyle(document.querySelector('.project-tab[data-selected=true]')).backgroundColor };
  }`);

  expect(row.rule).toBe("1px");
  expect(row.selectedCovers).toBe(true);
  expect(row.restCovers).toBe(true);
  // The rule shows through a transparent inactive tab and is covered by the selected tab's opaque ground.
  expect(row.restGround).toBe("rgba(0, 0, 0, 0)");
  expect(row.selectedGround).not.toBe("rgba(0, 0, 0, 0)");
}, 90_000);

it("u2232_tab_text_keeps_contrast", async () => {
  for (const scheme of ["light", "dark"] as const) for (const surface of ["strip", "runs"] as const) {
    if (surface === "strip") await strip(scheme);
    else await runs(scheme);

    const selector = surface === "strip" ? ".project-tab" : ".terminal-tab-pair";
    const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const lum = (value: string) => rgb(value).reduce((sum, c, i) => sum + [0.2126, 0.7152, 0.0722][i]! * (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4), 0);
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const reading = await page.call<{ grey: string; text: string; sunken: string; ground: string; rest: string; selected: string }>(`(t, b, selector) => ({ grey: eval(t)('--grey'), text: eval(t)('--text'), sunken: eval(b)('--sunken'), ground: eval(b)('--ground'), rest: getComputedStyle(document.querySelector(selector + '[data-selected=false]')).color, selected: getComputedStyle(document.querySelector(selector + '[data-selected=true]')).color })`, token, tokenBg, selector);

    expect(reading.rest).toBe(reading.grey);
    expect(ratio(reading.rest, reading.sunken), scheme + surface).toBeGreaterThanOrEqual(4.5);
    expect(ratio(reading.selected, reading.ground), scheme + surface).toBeGreaterThanOrEqual(4.5);
  }
}, 120_000);

it("u2231_no_other_stylesheet_styles_a_tab", () => {
  const root = join(__dirname, "..");
  const sheets = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sheets(join(dir, entry.name)) : entry.name.endsWith(".css") && !["flat-tab.styles.css", "buttons.css"].includes(entry.name) ? [join(dir, entry.name)] : []);
  const tab = /\.(project-tab|terminal-tab-pair|terminal-tab)(?![\w-])|\[data-flat-(tab|add)\]/;
  const look = /^\s*(border(-[a-z]+)*|background(-[a-z]+)*|box-shadow|color|--button-(surface|hover|radius)):/;
  // buttons.css holds the ink of a button in any state (U170); the tab's own box and rest colour are in flat-tab.styles.css.
  const found: string[] = [];

  for (const file of sheets(root)) for (const rule of readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // A pseudo-element (the drop outline) is not the tab's own box.
    const selectors = rule[1]!.split(",").filter(selector => tab.test(selector) && !selector.includes("::"));

    if (selectors.length) for (const line of rule[2]!.split(";")) if (look.test(line)) found.push(`${file}: ${selectors.join(",").trim()} { ${line.trim()} }`);
  }

  expect(found).toEqual([]);
});

it("u2232_hover_and_selection_move_no_tab", async () => {
  const boxes = `() => [...document.querySelectorAll('.project-tab, .terminal-tab-pair')].map(t => { const r = t.getBoundingClientRect(); const n = t.querySelector('.tab-name-button, .terminal-tab').getBoundingClientRect(); const c = t.querySelector('.tab-close, button:last-of-type').getBoundingClientRect(); return [r.width, r.height, r.top, n.width, n.height, c.width, c.height]; })`;

  for (const surface of ["strip", "runs"] as const) {
    if (surface === "strip") await strip("light");
    else await runs("light");

    const tabs = surface === "strip" ? ".project-tab" : ".terminal-tab-pair";
    const rest = await page.call<number[][]>(boxes);
    const at = await page.call<{ x: number; y: number }>(`(tabs) => { const list = document.querySelector(tabs === '.project-tab' ? '.tablist' : '.terminal-tabs-host').getBoundingClientRect(); const tab = [...document.querySelectorAll(tabs + '[data-selected=false]')].find(t => { const r = t.getBoundingClientRect(); return r.left >= list.left && r.right <= list.right; }); const r = tab.querySelector('.tab-name-button, .terminal-tab').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`, tabs);

    await page.hover(at.x, at.y);
    expect(await page.call<number[][]>(boxes), surface + " hover").toEqual(rest);

    await page.click(at.x, at.y);
    expect(await page.call<number[][]>(boxes), surface + " select").toEqual(rest);
    expect(Math.min(...rest.map(row => row[4]!)), surface).toBeGreaterThanOrEqual(24);
  }
}, 120_000);

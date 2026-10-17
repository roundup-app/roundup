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
    expect(await page.call<string>(`(t) => getComputedStyle(document.querySelector('.window-bar')).backgroundColor === eval(t)('--sunken') ? 'ok' : 'no'`, tokenBg), scheme).toBe("ok");

    await runs(scheme);

    const terminal = await page.call<{ radii: string[]; ground: boolean }>(`(t) => ({ radii: ['.resource-strip', '.terminal-tab-pair', '.terminal-new', '.terminal-tab-pair > button:last-of-type'].map(s => getComputedStyle(document.querySelector(s)).borderRadius), ground: getComputedStyle(document.querySelector('.resource-strip')).backgroundColor === eval(t)('--sunken') })`, tokenBg);

    expect(terminal, scheme + " runs").toEqual({ radii: ["0px", "0px", "0px", "0px"], ground: true });
  }
}, 90_000);

it("u2232_the_selected_tab_joins_the_page", async () => {
  for (const scheme of ["light", "dark"] as const) for (const surface of ["strip", "runs"] as const) {
    if (surface === "strip") await strip(scheme);
    else await runs(scheme);

    const selector = surface === "strip" ? ".project-tab" : ".terminal-tab-pair";
    const reading = await page.call<{ look: Look; ground: string; hairline: string; sides: string[] }>(`(look, token, selector) => { const s = getComputedStyle(document.querySelector(selector + '[data-selected=true]')); return { look: eval(look)(selector + '[data-selected=true]', 0), ground: eval(token)('--ground'), hairline: eval(token)('--hairline'), sides: [s.borderLeftColor, s.borderRightColor] }; }`, look, tokenBg, selector);

    expect(reading.look.ground, scheme + surface).toBe(reading.ground);
    expect(reading.look.border.slice(0, 4), scheme + surface).toEqual(["0px", "1px", "0px", "1px"]);
    expect(reading.sides, scheme + surface).toEqual([reading.hairline, reading.hairline]);
  }
}, 90_000);

it("u2232_inactive_tabs_have_no_box", async () => {
  for (const scheme of ["light", "dark"] as const) for (const surface of ["strip", "runs"] as const) {
    if (surface === "strip") await strip(scheme);
    else await runs(scheme);

    const tabs = surface === "strip" ? ".project-tab" : ".terminal-tab-pair";
    const at = await page.call<{ x: number; y: number }>(`(tabs) => { const list = document.querySelector(tabs === '.project-tab' ? '.tablist' : '.terminal-tabs-host').getBoundingClientRect(); const tab = [...document.querySelectorAll(tabs + '[data-selected=false]')].find(t => { const r = t.getBoundingClientRect(); return r.left >= list.left && r.right <= list.right; }); tab.id = 'pressed'; const r = tab.querySelector('.tab-name-button, .terminal-tab').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`, tabs);
    const grey = await page.call<string>(`(t) => eval(t)('--grey')`, token);
    const read = `(look) => eval(look)('#pressed', 0)`;
    const rest = await page.call<Look>(read, look);

    expect(rest.border.slice(0, 4), scheme + surface).toEqual(["0px", "0px", "0px", "0px"]);
    expect(rest.ground, scheme + surface).toBe("rgba(0, 0, 0, 0)");
    expect(rest.shadow, scheme + surface).toBe("none");
    expect(rest.colour, scheme + surface).toBe(grey);

    // Held down, the tab still paints no box.
    await page.pointer("down", at.x, at.y);

    const pressed = await page.call<Look>(read, look);

    await page.pointer("up", at.x, at.y);
    expect({ border: pressed.border, ground: pressed.ground, shadow: pressed.shadow }, scheme + surface + " pressed").toEqual({ border: rest.border, ground: rest.ground, shadow: rest.shadow });
  }
}, 90_000);

it("u2233_hover_moves_only_the_label_colour", async () => {
  // Each control the scenario names: an inactive tab, and the `+`, on both surfaces.
  const targets = [
    { surface: "strip", control: ".project-tab[data-selected=false]", point: ".tab-name-button", host: ".tablist" },
    { surface: "strip", control: ".strip-add", point: "", host: ".window-bar" },
    { surface: "runs", control: ".terminal-tab-pair[data-selected=false]", point: ".terminal-tab", host: ".terminal-tabs-host" },
    { surface: "runs", control: ".terminal-new", point: "", host: ".terminal-tabs-host" },
  ] as const;

  for (const target of targets) {
    if (target.surface === "strip") await strip("light");
    else await runs("light");

    // The first control the host shows whole.
    const at = await page.call<{ x: number; y: number }>(`(target) => { const list = document.querySelector(target.host).getBoundingClientRect(); const control = [...document.querySelectorAll(target.control)].find(t => { const r = t.getBoundingClientRect(); return r.width > 0 && r.left >= list.left - 0.5 && r.right <= list.right + 0.5; }); control.id = 'hovered'; const r = (target.point ? control.querySelector(target.point) : control).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`, target);
    const read = `(look) => eval(look)('#hovered', 0)`;
    const before = await page.call<Look>(read, look);
    const [grey, text] = await page.call<string[]>(`(t) => [eval(t)('--grey'), eval(t)('--text')]`, token);

    expect(before.colour, target.control).toBe(grey);

    await page.hover(at.x, at.y);
    await page.until(`() => getComputedStyle(document.querySelector('#hovered')).color === '${text}'`);

    const after = await page.call<Look>(read, look);

    expect({ ...after, colour: "" }, target.control).toEqual({ ...before, colour: "" });
    expect(after.ground, target.control).toBe("rgba(0, 0, 0, 0)");
  }
}, 120_000);

it("u2233_keyboard_focus_draws_a_ring_and_a_click_does_not", async () => {
  const ring = `() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineWidth]; }`;

  const targets = [
    { surface: "strip", controls: [".project-tab .tab-name-button", ".project-tab .tab-close", ".strip-add"], bar: ".window-bar" },
    { surface: "runs", controls: [".terminal-tab", ".terminal-tab-pair > button:last-of-type", ".terminal-new"], bar: ".resource-strip" },
  ] as const;

  for (const { surface, controls, bar } of targets) {
    if (surface === "strip") await strip("light");
    else await runs("light");

    // A click on the `+` opens a Terminal that takes focus itself, so the Terminal surface is clicked on a tab.
    const clicked = surface === "strip" ? controls[2] : controls[0];
    const at = await page.call<{ x: number; y: number }>(`(control) => { const r = document.querySelector(control).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`, clicked);

    await page.click(at.x, at.y);
    expect((await page.call<string[]>(ring))[0], surface + " click").toBe("none");

    // One real key press makes the next focus a keyboard focus.
    await page.press("Tab", "Tab");

    const accent = await page.call<string>(`(t) => eval(t)('--accent')`, token);

    for (const control of controls) {
      const keyboard = await page.call<{ style: string; width: number; colour: string; inside: boolean }>(`(control, bar) => {
        const node = document.querySelector(control);
        node.focus();
        const s = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        const b = document.querySelector(bar).getBoundingClientRect();
        const width = parseFloat(s.outlineWidth);
        const grow = width + parseFloat(s.outlineOffset);
        // The ring's outer edge is the control's box grown by the width plus the offset.
        return { style: s.outlineStyle, width, colour: s.outlineColor, inside: r.top - grow >= b.top - 0.5 && r.bottom + grow <= b.bottom + 0.5 && r.left - grow >= b.left - 0.5 && r.right + grow <= b.right + 0.5 };
      }`, control, bar);

      expect(keyboard, `${surface} ${control}`).toEqual({ style: "solid", width: keyboard.width, colour: accent, inside: true });
      expect(keyboard.width, `${surface} ${control}`).toBeGreaterThanOrEqual(2);
    }
  }
}, 120_000);

it("u2234_a_rename_field_has_the_tab_type_and_no_border", async () => {
  const surfaces = [
    { surface: "strip", tab: ".project-tab", name: ".tab-name", field: ".tab-rename" },
    { surface: "runs", tab: ".terminal-tab-pair", name: ".terminal-tab-name", field: ".terminal-tab-editor input" },
  ] as const;

  for (const { surface, tab, name, field } of surfaces) for (const state of ["selected", "rest"] as const) {
    if (surface === "strip") await strip("light");
    else await runs("light");

    // The first tab in this state the region shows whole.
    const at = await page.call<{ x: number; y: number }>(`(tab, name, selected) => { const list = document.querySelector(tab === '.project-tab' ? '.tablist' : '.terminal-tabs-host').getBoundingClientRect(); const node = [...document.querySelectorAll(tab + '[data-selected=' + selected + ']')].find(t => { const r = t.getBoundingClientRect(); return r.left >= list.left && r.right <= list.right; }); node.id = 'renamed'; const r = node.querySelector(name).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`, tab, name, String(state === "selected"));
    const box = `() => { const r = document.querySelector('#renamed').getBoundingClientRect(); return [r.width, r.height, r.left, r.top]; }`;
    const before = await page.call<number[]>(box);

    // F2 on a Project tab's name renames without selecting it; a double click would select it first.
    if (surface === "strip" && state === "rest") {
      await page.call(`() => document.querySelector('#renamed .tab-name-button').focus()`);
      await page.press("F2", "F2");
    } else await page.doubleClick(at.x, at.y);

    await page.until(`() => document.activeElement?.matches(${JSON.stringify(field)})`);

    const read = await page.call<{ font: string; border: string; radius: string; ground: string; tab: string; selected: string | null }>(`(field) => { const i = document.activeElement; const s = getComputedStyle(i); const t = getComputedStyle(document.querySelector('#renamed')); return { font: [s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight].join('|'), border: s.borderTopWidth + ' ' + s.borderRightWidth + ' ' + s.borderBottomWidth + ' ' + s.borderLeftWidth, radius: s.borderRadius, ground: s.backgroundColor, tab: [t.fontFamily, t.fontSize, t.fontWeight, t.lineHeight].join('|'), selected: document.querySelector('#renamed').getAttribute('data-selected') }; }`, field);
    const during = await page.call<number[]>(box);
    const label = `${surface} ${state}`;

    expect(read.selected, label).toBe(String(state === "selected"));
    expect(read.font, label).toBe(read.tab);
    expect(read.border, label).toBe("0px 0px 0px 0px");
    expect(read.radius, label).toBe("0px");
    expect(read.ground, label).toBe("rgba(0, 0, 0, 0)");
    expect(during, label).toEqual(before);
  }
}, 120_000);

it("u2235_flat_tabs_scroll_inside_the_pane_and_stay_reachable", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await runs(scheme);

    const ends = await page.call<{ host: number; values: number; shelf: number }>(`() => ({ host: document.querySelector('.terminal-tabs-host').getBoundingClientRect().right, values: Math.min(...[...document.querySelectorAll('.centre .resource-strip > span')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getBoundingClientRect().left), Infinity), shelf: (() => { const r = document.querySelector('.shelf').getBoundingClientRect(); return r.left > document.querySelector('.terminal-tabs-host').getBoundingClientRect().left ? r.left : Infinity; })() })`);

    expect(ends.host, scheme).toBeLessThanOrEqual(Math.min(ends.values ?? Infinity, ends.shelf ?? Infinity) + 0.5);

    const count = await page.call<number>(`() => document.querySelectorAll('.terminal-tab-pair').length`);

    for (let index = 0; index < count; index++) {
      // A tab's name arrives after its pair mounts; its hit test starts once this tab carries one.
      await page.until(`() => Boolean(document.querySelectorAll('.terminal-tab-pair')[${index}]?.querySelector('.terminal-tab')?.getAttribute('aria-label'))`);
      await page.call(`(i) => document.querySelectorAll('.terminal-tab-pair')[i].querySelector('.terminal-tab').focus()`, index);

      // The point at the middle of what the region shows of each control hits that control.
      const hit = await page.call<{ tab: boolean; close: boolean; named: boolean; scrim: boolean }>(`(i) => {
        const host = document.querySelector('.terminal-tabs-host').getBoundingClientRect();
        const tab = document.querySelectorAll('.terminal-tab-pair')[i].querySelector('.terminal-tab');
        const close = document.querySelectorAll('.terminal-tab-pair')[i].querySelector('button:last-of-type');
        const at = (e) => { const r = e.getBoundingClientRect(); const left = Math.max(r.left, host.left), right = Math.min(r.right, host.right); return right > left && document.elementFromPoint((left + right) / 2, r.y + r.height / 2); };
        return { tab: tab.contains(at(tab)), close: close.contains(at(close)) || tab.getBoundingClientRect().width > host.width, named: tab.getAttribute('aria-label') === tab.querySelector('.terminal-tab-name').textContent && tab.getAttribute('aria-label') !== '', scrim: document.querySelector('.shelf-scrim') !== null };
      }`, index);

      expect(hit.named, `${scheme} ${index}`).toBe(true);
      expect({ tab: hit.tab, close: hit.close }, `${scheme} ${index} scrim ${hit.scrim}`).toEqual({ tab: true, close: true });
    }
  }
}, 240_000);

it("u2235_a_cut_tab_name_is_shown_by_the_shared_tooltip", async () => {
  await runs("light", undefined, "dense");

  // One Run is named with sixty characters, so its tab cuts the name once the name has arrived.
  const long = `.terminal-tab[aria-label^="a-run-named"]`;

  await page.until(`() => document.querySelector(${JSON.stringify(long)})`);

  const cut = await page.call<{ x: number; y: number; name: string; cut: boolean }>(`(long) => { const tab = document.querySelector(long); const name = tab.querySelector('.terminal-tab-name'); const r = name.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: tab.getAttribute('aria-label'), cut: name.scrollWidth > name.clientWidth }; }`, long);

  expect(cut.cut).toBe(true);
  expect(await page.call<number>(`() => document.querySelectorAll('.app-tooltip').length`)).toBe(0);

  await page.hover(cut.x, cut.y);
  await page.until(`() => document.querySelector('.app-tooltip')?.textContent === ${JSON.stringify(cut.name)}`);
}, 60_000);

it("u2235_the_selected_tab_keeps_its_borders_while_scrolled", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await runs(scheme);
    await page.call(`() => { const bar = document.querySelector('.terminal-tabs'); document.querySelector('.terminal-tab[aria-pressed=true]').focus(); bar.scrollLeft = bar.scrollWidth; }`);

    const edges = await page.call<{ left: number; right: number; clipped: boolean }>(`() => {
      const pair = document.querySelector('.terminal-tab-pair[data-selected=true]');
      const s = getComputedStyle(pair);
      const host = document.querySelector('.terminal-tabs-host').getBoundingClientRect();
      const r = pair.getBoundingClientRect();
      return { left: parseFloat(s.borderLeftWidth), right: parseFloat(s.borderRightWidth), clipped: r.left < host.left - 0.5 || r.right > host.right + 0.5 };
    }`);

    expect(edges, scheme).toEqual({ left: 1, right: 1, clipped: false });
  }
}, 120_000);

it("u2232_the_rule_breaks_only_under_the_selected_tab", async () => {
  // The bar's rule is 1 px --hairline; an inactive tab is transparent so the rule shows, and the selected tab's opaque --ground covers it.
  const read = `(bar, tabs, ground, hairline) => {
    const header = document.querySelector(bar).getBoundingClientRect();
    const rule = getComputedStyle(document.querySelector(bar), '::after');
    const selected = document.querySelector(tabs + '[data-selected=true]');
    const rest = [...document.querySelectorAll(tabs + '[data-selected=false]')];
    const covers = (tab) => tab.getBoundingClientRect().bottom >= header.bottom;
    const r = selected.getBoundingClientRect();
    // The hairline is the bar's ::after pseudo-element, so a point it paints over reports the bar itself.
    const under = document.elementFromPoint(r.left + r.width / 2, header.bottom - 0.5);

    return { rule: rule.height, ruleColour: rule.backgroundColor === eval(hairline)('--hairline'), selectedCovers: covers(selected), selectedGround: getComputedStyle(selected).backgroundColor === eval(ground)('--ground'), selectedHit: under !== document.querySelector(bar), restCovers: rest.every(covers), restClear: rest.every(t => getComputedStyle(t).backgroundColor === 'rgba(0, 0, 0, 0)'), borders: [getComputedStyle(selected).borderLeftWidth, getComputedStyle(selected).borderRightWidth] };
  }`;

  const expected = { rule: "1px", ruleColour: true, selectedCovers: true, selectedGround: true, selectedHit: true, restCovers: true, restClear: true, borders: ["1px", "1px"] };

  for (const scheme of ["light", "dark"] as const) for (const contrast of [undefined, "more"] as const) {
    await page.scheme(scheme, contrast);

    for (const projects of [1, 3, 8]) {
      await page.load("/harness.html?seed=tabs-8", 1512, 950);
      await page.until(`() => document.querySelectorAll('.project-tab').length === 8`);

      // Closing from the end leaves the first Project selected.
      for (let open = 8; open > projects; open--) {
        await page.call(`() => [...document.querySelectorAll('.project-tab .tab-close')].at(-1).click()`);
        // A Project with a running Agent asks first (U184); the question is answered by stopping.
        await page.call(`() => new Promise(done => setTimeout(() => { document.querySelector('[role=alertdialog] button:last-of-type')?.click(); done(null); }, 100))`);
        await page.until(`() => document.querySelectorAll('.project-tab').length === ${open - 1}`);
      }

      expect(await page.call(`(read, g, t) => eval(read)('.window-bar', '.project-tab', g, t)`, read, tokenBg, tokenBg), `${scheme} ${contrast} ${projects}`).toEqual(expected);
    }

    // The Terminal region turns the bar over: its rule is the 1 px --hairline at the tab row's top edge, and the selected tab opens up through it.
    for (const agent of ["first-workstream", "runner"] as const) {
      await runs(scheme, contrast, agent);

      const terminals = await page.call<{ rule: string; ruleColour: boolean; selectedGround: boolean; sides: boolean; selectedHit: boolean; restClear: boolean; several: boolean }>(`(g) => {
        const bar = document.querySelector('.resource-strip');
        const rule = getComputedStyle(bar, '::after');
        const selected = document.querySelector('.terminal-tab-pair[data-selected=true]');
        const rest = [...document.querySelectorAll('.terminal-tab-pair[data-selected=false]')];
        const s = getComputedStyle(selected);
        const r = selected.getBoundingClientRect();
        const ruleTop = bar.getBoundingClientRect().top + parseFloat(rule.top);
        const hairline = eval(g)('--hairline');

        return { rule: rule.height, ruleColour: rule.backgroundColor === hairline, selectedGround: s.backgroundColor === eval(g)('--ground'), sides: s.borderLeftColor === hairline && s.borderRightColor === hairline && s.borderLeftWidth === '1px' && s.borderRightWidth === '1px', selectedHit: document.elementFromPoint(r.left + r.width / 2, ruleTop + 0.5) !== bar, restClear: rest.every(t => getComputedStyle(t).backgroundColor === 'rgba(0, 0, 0, 0)'), several: document.querySelectorAll('.terminal-tab-pair').length > 1 };
      }`, tokenBg);

      expect(terminals, `${scheme} ${contrast} ${agent}`).toEqual({ rule: "1px", ruleColour: true, selectedGround: true, sides: true, selectedHit: true, restClear: true, several: agent === "runner" });
    }
  }

  // With no Project open (U2) the rule runs under the `+`.
  await page.load("/harness.html?seed=first-run", 1512, 950);
  await page.until(`() => document.querySelector('.strip-add')`);

  const bare = await page.call<{ under: boolean; covered: boolean }>(`() => {
    const header = document.querySelector('.window-bar').getBoundingClientRect();
    const add = document.querySelector('.strip-add').getBoundingClientRect();
    const rule = getComputedStyle(document.querySelector('.window-bar'), '::after');
    return { under: rule.height === '1px' && header.left <= add.left && header.right >= add.right, covered: [...document.querySelectorAll('.project-tab')].length > 0 };
  }`);

  expect(bare).toEqual({ under: true, covered: false });
}, 240_000);

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

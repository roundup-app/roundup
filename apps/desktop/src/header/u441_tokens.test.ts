import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";

const BASE = "fc11ba9c551b485b3f160228a018960200f75517";

const paths = ["tokens.css", "styles.css", "buttons.css", "header/strip.styles.css"];

const baseline = paths.map((path) => ({ path, css: execFileSync("git", ["show", `${BASE}:apps/desktop/src/${path}`], { encoding: "utf8" }) }));

const ART = captureDir("U441");

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U441 requires headless Chromium");
  page = await openPage(chrome);
}, 60_000);

afterAll(async () => {
  await page?.close();

  if (ART) {
    mkdirSync(ART, { recursive: true });
    writeFileSync(join(ART, "README.md"), `# U441 Token evidence

Baseline: main ${BASE}. Head: the source in this PR. Chromium uses a fresh isolated profile.

Both schemes, normal/more contrast, 1280×820 and 700×800: rest, hover, selected, selected hover, close hover, pressed, disabled, keyboard focus, rename, overflow and failure/reopen. The Rail, centre pane, Shelf, Drawer, tooltip and close dialog are measured before and after the contract. The existing U179–U186 tests remain unchanged.

Each state compares every passing Check on the baseline against the head. A \`-main\` image/check pair uses the baseline styles on the same rendered DOM and interaction state; its unmarked pair uses the head. JSON colour rows retain unrounded composited channels and text/selected contrast readings. The seed matrix covers first-run, agents-10, tree-40 and three Projects.

The contrast fixture temporarily draws a 1 px Token border on the existing tabs, so its actual computed border colour is measured. Overflow measurement constrains only the fixture's strip width. Neither changes runtime geometry. The seed matrix and behaviour test use runtime geometry. U440, U442 and U443 remain #1093's work.

\`tree-40\` retains its baseline D14 failure (unequal Shelf row gaps); no passing Check regresses. These captures show the webview, not native macOS behaviour.
`);
  }
});

const schemes = ["light", "dark"] as const;

const contrasts = [undefined, "more"] as const;

// Resolve the actual painted ancestor chain, without rounding alpha channels before luminance.
const PAINT = `selector => {
  const rgb = value => {
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const match = /^rgba?\\(([^)]+)\\)$/.exec(value.trim());
    if (!match) throw new Error('unresolved colour: ' + value);
    const channels = match[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    return channels.length === 3 ? channels.concat(1) : channels;
  };
  const over = (top, bottom) => top.slice(0,3).map((c,i) => c * top[3] + bottom[i] * (1-top[3])).concat(1);
  const el = document.querySelector(selector);
  if (!el) throw new Error('missing surface ' + selector);
  const chain = [];
  for (let node = el; node; node = node.parentElement) chain.unshift(node);
  let ground = rgb(getComputedStyle(document.documentElement).getPropertyValue('--ground'));
  const layers = [];
  for (const node of chain) {
    const css = getComputedStyle(node);
    const layer = rgb(css.backgroundColor);
    layers.push({ element: node.className, colour: css.backgroundColor });
    ground = over(layer, ground);
    if (css.backgroundImage !== 'none') {
      const wash = /^linear-gradient\\((rgba?\\([^)]+\\)),\\s*\\1\\)$/.exec(css.backgroundImage);
      if (!wash) throw new Error('unexpected painted layer ' + css.backgroundImage);
      layers.push({ element: node.className, colour: wash[1] });
      ground = over(rgb(wash[1]), ground);
    }
  }
  const css = getComputedStyle(el);
  const tokens = Object.fromEntries(['ground','sunken','hover','selected','selected-hover','pressed','text','grey','disabled','accent','red','amber','hairline'].map(name => [name, css.getPropertyValue('--'+name).trim()]));
  return { ground, ink: over(rgb(css.color), ground), tokens, layers,
    border: rgb(css.borderTopColor), borderStyle: css.borderTopStyle, borderWidth: css.borderTopWidth, red: rgb(tokens.red), amber: rgb(tokens.amber), focus: rgb(tokens.accent), outline: rgb(css.outlineColor), outlineStyle: css.outlineStyle,
    hover: tokens.hover, pressed: tokens.pressed, duration: css.transitionDuration,
    colour: css.color, background: css.backgroundColor, image: css.backgroundImage,
    rect: { x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height } };
}`;

type Paint = {
  ground: number[]; ink: number[]; border: number[]; red: number[]; amber: number[]; focus: number[]; outline: number[]; outlineStyle: string;
  borderStyle: string; borderWidth: string;
  tokens: Record<string, string>; layers: { element: string; colour: string }[];
  hover: string; pressed: string; duration: string; colour: string; background: string; image: string;
  rect: { x: number; y: number; width: number; height: number };
};

const paint = (selector: string) => page.call<Paint>(PAINT, selector);

const lum = (rgb: number[]) => rgb.slice(0, 3).reduce((sum, c, i) => {
  const s = c / 255;

  return sum + [0.2126, 0.7152, 0.0722][i]! * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
}, 0);

const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const readChecks = () => page.call<Checks>("() => window.__checks()");

type ColourRows = Record<string, string | Paint | number | Record<string, Paint>> | { before: Checks; after: Checks };

const save = async (name: string, rows: ColourRows | (ColourRows | Paint)[] | null = null) => {
  if (name.endsWith("-base")) {
    if (!ART) return;

    mkdirSync(ART, { recursive: true });
    writeFileSync(join(ART, `${name}.png`), Buffer.from(await page.shot(), "base64"));
    writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(await readChecks()));

    return;
  }

  await useMain(true);
  const before = await readChecks();

  if (ART) {
    mkdirSync(ART, { recursive: true });
    writeFileSync(join(ART, `${name}-main.png`), Buffer.from(await page.shot(), "base64"));
    writeFileSync(join(ART, `${name}-main.checks.json`), JSON.stringify(before));
  }

  await useMain(false);
  const after = await readChecks();

  for (const id of CHECK_IDS) if (before[id].status === "pass") expect(after[id].status, `${name}/${id}: ${JSON.stringify(after[id])}`).toBe("pass");

  if (!ART) return;

  writeFileSync(join(ART, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(after));

  if (rows) writeFileSync(join(ART, `${name}.colours.json`), JSON.stringify({ baseline: BASE, rows }));
};

const load = async (seed = "agents-10", width = 1280, height = 820) => {
  await page.load(`/harness.html?seed=${seed}`, width, height);
  await page.until("() => window.__checks && document.querySelector('.strip-add')");
};

const three = async (width = 1280, height = 820) => {
  await load("agents-10", width, height);

  for (const name of ["web", "docs"]) {
    await page.call(`name => { window.__fake.app.chooser.path = '/u441/' + name; document.querySelector('.strip-add').click(); }`, name);
    await page.until(`() => [...document.querySelectorAll('.project-tab')].some(el => el.dataset.path === '/u441/${name}')`);
  }

  await page.until("() => document.querySelectorAll('.project-tab').length === 3");
};

const useMain = async (on: boolean) => {
  await page.call(`(on, originals) => {
    for (const {path, css} of originals) {
      const sheet = [...document.querySelectorAll('style[data-vite-dev-id]')].find(el => el.dataset.viteDevId.endsWith('/src/' + path));
      if (!sheet) throw new Error('missing shipped stylesheet ' + path);
      if (!sheet.dataset.u441Head) sheet.dataset.u441Head = sheet.textContent;
      sheet.textContent = on ? css : sheet.dataset.u441Head;
    }
  }`, on, baseline);
};

const point = async (selector: string) => {
  const { rect } = await paint(selector);

  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

const hover = async (selector: string) => {
  const p = await point(selector);
  await page.hover(p.x, p.y);
};

const selectFirst = async () => {
  await page.call("() => document.querySelector('.tab-name-button').click()");
  await page.until("() => document.querySelector('.tab-name-button').getAttribute('aria-selected') === 'true'");
};

it("u441_token_surfaces_keep_contrast", async () => {
  for (const scheme of schemes) for (const contrast of contrasts) for (const [width, height] of [[1280,820],[700,800]] as const) {
    await page.scheme(scheme, contrast);
    await three(width, height);
    // This Token fixture draws the future border only for contrast measurement; runtime geometry remains U440's work.
    await page.call(`() => { const sheet = document.createElement('style'); sheet.textContent = '.project-tab { border: 1px solid var(--hairline); }'; document.head.append(sheet); }`);
    const capture = `${scheme}-${contrast ?? "normal"}-${width}`;
    await page.hover(0, 700);
    const header = await paint('.header');
    expect(header.background).toBe(scheme === 'light' ? 'rgb(128, 128, 128)' : 'rgb(28, 28, 30)');
    const rest = await paint('.project-tab');
    const restText = await paint('.tab-name-button');
    expect(ratio(restText.ink, restText.ground)).toBeGreaterThanOrEqual(4.5);
    await save(`${capture}-rest`, { header, rest, restText });
    await hover('.tab-name-button');
    const hovered = await paint('.project-tab');
    const hoveredText = await paint('.tab-name-button');
    expect(ratio(hoveredText.ink, hoveredText.ground)).toBeGreaterThanOrEqual(4.5);
    await save(`${capture}-hover`, { hovered, hoveredText });
    await selectFirst();
    await page.hover(0, 700);
    const selected = await paint('.project-tab');
    await save(`${capture}-selected`, { header, selected, ratio: ratio(selected.ground, header.ground) });
    await hover('.tab-name-button');
    const selectedHover = await paint('.project-tab');
    const states = { rest, hovered, selected, selectedHover };
    await save(`${capture}-selected-hover`, { header, selectedHover, ratio: ratio(selectedHover.ground, header.ground) });

    for (const [state, box] of Object.entries(states)) {
      expect(box.borderStyle).toBe('solid');
      expect(box.borderWidth).toBe('1px');
      expect(ratio(box.border, header.ground), state + ' border/header').toBeGreaterThanOrEqual(3);
      expect(ratio(box.border, box.ground), state + ' border/tab').toBeGreaterThanOrEqual(3);
      const mark = await paint('.tab-mark');

      for (const name of ['red', 'amber'] as const) expect(ratio(mark[name], box.ground), state + ' ' + name).toBeGreaterThanOrEqual(3);
      expect(ratio(box.focus, box.ground), state + ' focus').toBeGreaterThanOrEqual(3);
    }

    for (const box of [selected, selectedHover]) {
      expect(ratio(box.ground, header.ground)).toBeGreaterThanOrEqual(3);
      expect(lum(box.ground)).toBeGreaterThan(lum(rest.ground));
      expect(lum(box.ground)).toBeGreaterThan(lum(hovered.ground));
    }

    const rows: (ColourRows | Paint)[] = [states];

    for (const selector of ['.tab-name-button', '.tab-close', '.strip-add']) {
      await hover(selector);
      const before = await paint(selector);
      expect(ratio(before.ink, before.ground), selector).toBeGreaterThanOrEqual(4.5);
      await save(`${capture}-${selector.slice(1)}-hover`, { before, textRatio: ratio(before.ink, before.ground) });
      const p = await point(selector);
      await page.down(p.x, p.y);
      const pressed = await paint(selector);
      expect(pressed.background, selector + ' distinct press').not.toBe(before.background);
      expect(pressed.duration).toBe('0s');
      await save(`${capture}-${selector.slice(1)}-pressed`, { pressed, textRatio: ratio(pressed.ink, pressed.ground) });
      expect(ratio(pressed.ink, pressed.ground), selector + ' pressed').toBeGreaterThanOrEqual(4.5);
      // Moving off before release observes :active without closing/selecting the target.
      await page.pointer('move', 0, 700);
      await page.release(0, 700);
      await page.call(`selector => document.querySelector(selector).setAttribute('aria-disabled','true')`, selector);
      const disabled = await paint(selector);
      expect(ratio(disabled.ink, disabled.ground), selector + ' disabled').toBeGreaterThanOrEqual(4.5);
      await save(`${capture}-${selector.slice(1)}-disabled`, { disabled, textRatio: ratio(disabled.ink, disabled.ground) });
      await page.call(`selector => document.querySelector(selector).removeAttribute('aria-disabled')`, selector);
      rows.push({ selector, before, pressed, disabled });
    }

    await page.call("() => document.querySelector('.tab-name-button').focus()");
    await page.press('Tab', 'Tab');
    await page.call("() => document.querySelector('.tab-name-button').focus()");
    const focused = await paint('.tab-name-button');
    expect(focused.outlineStyle).not.toBe('none');
    expect(ratio(focused.outline, focused.ground)).toBeGreaterThanOrEqual(3);
    expect(ratio(focused.outline, header.ground)).toBeGreaterThanOrEqual(3);
    await save(`${capture}-focus`, { focused });
    await page.press('F2', 'F2');
    await page.until("() => document.querySelector('.tab-rename')");
    const rename = await paint('.tab-rename');
    expect(ratio(rename.ink, rename.ground)).toBeGreaterThanOrEqual(4.5);
    await save(`${capture}-rename`, rows.concat(rename));
    await page.press('Escape', 'Escape');
    await page.until("() => !document.querySelector('.tab-rename')");
    await save(`${capture}-surfaces`, rows);
    await page.call("() => window.__fake.app.exitDaemon({code: 1})");
    await page.until("() => document.querySelector('.header [role=alert]')");
    const failure = await paint('.header [role=alert]');
    const reopenSelector = '.header button[aria-disabled]';
    await page.call("() => { const b = [...document.querySelectorAll('.header button')].find(el => el.textContent === 'reopen'); b.id = 'u441-reopen'; }");
    const reopen = await paint('#u441-reopen');
    expect(ratio(failure.ink, failure.ground)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(reopen.ink, reopen.ground)).toBeGreaterThanOrEqual(4.5);
    await page.call("() => document.querySelector('#u441-reopen').setAttribute('aria-disabled','true')");
    const off = await paint(reopenSelector);
    expect(ratio(off.ink, off.ground)).toBeGreaterThanOrEqual(4.5);
    await save(`${capture}-failure`, { failure, reopen, off });
    await load('tabs-8', width, height);
    await page.call(`() => { const sheet = document.createElement('style'); sheet.textContent = '.strip-scroll { max-width: var(--rail-width); }'; document.head.append(sheet); }`);
    await page.until("() => document.querySelector('.strip-edge')");
    const edge = await paint('.strip-edge');
    expect(ratio(edge.ink, edge.ground)).toBeGreaterThanOrEqual(4.5);
    expect(edge.tokens.sunken).toBe(scheme === 'light' ? '#f5f5f7' : '#141416');
    await save(`${capture}-overflow`, { edge });

  }
}, 360_000);

it("u441_token_scope_keeps_other_surfaces", async () => {
  for (const scheme of schemes) for (const contrast of contrasts) {
    await page.scheme(scheme, contrast);
    await three();
    await selectFirst();
    await hover('.tab-name-button');
    await page.until("() => document.querySelector('.tab-tip')");
    // Render all root surfaces together, including a Drawer and Shelf via their real controls.
    await page.call("() => document.querySelector('.shelf-toggle').click()");
    await page.until("() => document.querySelector('.shelf')");
    const rootSelectors = ['.rail', '.centre', '.shelf', '.tab-tip'];
    const after = await Promise.all(rootSelectors.map(paint));
    await useMain(true);
    const before = await Promise.all(rootSelectors.map(paint));

    for (let i = 0; i < after.length; i++) {
      expect(after[i]!.tokens, rootSelectors[i]).toEqual(before[i]!.tokens);
      expect(after[i]!.ground, rootSelectors[i]).toEqual(before[i]!.ground);
      expect(after[i]!.ink, rootSelectors[i]).toEqual(before[i]!.ink);
    }

    await useMain(false);
    const tab = await paint('.project-tab');
    const header = await paint('.header');
    expect(tab.tokens.hairline).toBe(scheme === 'light' ? '#000000' : '#d8d8dc');

    if (contrast) {
      expect(tab.tokens.grey).toBe(tab.tokens.text);
      expect(header.tokens.grey).toBe(header.tokens.text);
    }

    await page.call("() => document.querySelector('.tab-close').click()");
    await page.until("() => document.querySelector('.close-dialog')");
    const dialog = await paint('.close-dialog');
    await useMain(true);
    const original = await paint('.close-dialog');
    expect(dialog.tokens).toEqual(original.tokens);
    expect(dialog.ground).toEqual(original.ground);
    expect(dialog.ink).toEqual(original.ink);
    await useMain(false);
    await save(`${scheme}-${contrast ?? 'normal'}-dialog`, { dialog });
    await load('tree-40');
    await page.call("() => { if (!document.querySelector('.window[data-shelf=open]')) document.querySelector('.shelf-toggle').click(); }");
    await page.until("() => [...document.querySelectorAll('button')].some(el => /#5/.test(el.getAttribute('aria-label') || el.textContent))");
    await page.call("() => [...document.querySelectorAll('button')].find(el => /#5/.test(el.getAttribute('aria-label') || el.textContent)).click()");
    await page.until("() => document.querySelector('.drawer[data-open=true]')");
    const drawer = await paint('.drawer');
    await useMain(true);
    const mainDrawer = await paint('.drawer');
    expect(drawer.tokens).toEqual(mainDrawer.tokens);
    expect(drawer.ground).toEqual(mainDrawer.ground);
    expect(drawer.ink).toEqual(mainDrawer.ink);
    await useMain(false);
    await save(`${scheme}-${contrast ?? 'normal'}-drawer`, { drawer });
  }
}, 120_000);

it("u441_token_observers_resolve_the_surface", async () => {
  for (const scheme of schemes) {
    await page.scheme(scheme);
    await three();
    await selectFirst();
    await page.call(`() => { const sheet = document.createElement('style'); sheet.textContent = '.header { border-bottom: 1px solid var(--hairline); }'; document.head.append(sheet); }`);
    const good = await readChecks();
    expect(good.D1.status).toBe('pass');
    expect(good.D3.status).toBe('pass');
    expect(good.D8.status).toBe('pass');

    for (const [css, check] of [
      ['.header .tab-mark { color: #ff00ff; }', 'D3'],
      ['.header { border-bottom: 1px solid var(--root-hairline); }', 'D8'],
      ['.header { --ground: #808080; }', 'D1'],
    ] as const) {
      await page.call(`css => { const sheet = document.createElement('style'); sheet.id = 'u441-off-token'; sheet.textContent = css; document.head.append(sheet); }`, css);
      expect((await readChecks())[check].status, css).toBe('fail');
      await page.call("() => document.getElementById('u441-off-token').remove()");
    }
  }
}, 60_000);

it("u441_token_checks_do_not_regress", async () => {
  for (const scheme of schemes) for (const contrast of contrasts) for (const seed of ['first-run','agents-10','tree-40','three']) for (const [width,height] of [[1280,820],[700,800]]) {
    await page.scheme(scheme, contrast);

    if (seed === 'three') { await three(); await page.resize(width!, height!); }
    else await load(seed, width, height);
    await page.hover(0, height! - 1);
    await useMain(true);
    const before = await readChecks();
    await save(`${scheme}-${contrast ?? 'normal'}-${seed}-${width}-base`);
    await useMain(false);
    const after = await readChecks();

    for (const id of CHECK_IDS) {
      const check = before[id];

      if (check.status === 'pass') expect(after[id].status, `${scheme}/${contrast}/${seed}/${width}/${id}: ${JSON.stringify(after[id])}`).toBe('pass');
    }

    await save(`${scheme}-${contrast ?? 'normal'}-${seed}-${width}-head`, { before, after });
  }
}, 180_000);

it("u441_token_change_keeps_header_behaviour", async () => {
  await three();
  await selectFirst();
  const selectors = ['.header', '.strip', '.project-tab', '.tab-name-button', '.tab-close', '.strip-add'];
  const after = await Promise.all(selectors.map(paint));
  await useMain(true);
  const before = await Promise.all(selectors.map(paint));
  expect(after.map(row => row.rect)).toEqual(before.map(row => row.rect));
  await useMain(false);
  await selectFirst();
  const selected = await Promise.all(selectors.map(paint));
  expect(selected.map(row => row.rect)).toEqual(after.map(row => row.rect));
  await hover('.tab-close');
  expect((await Promise.all(selectors.map(paint))).map(row => row.rect)).toEqual(after.map(row => row.rect));
}, 60_000);

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import baselineTokens from "./u441-baseline/tokens.css.txt?raw";
import windowStyles from "../styles.css?raw";
import stripStyles from "./strip.styles.css?raw";
import baselineButtons from "./u441-baseline/buttons.css.txt?raw";
import baselineStrip from "./u441-baseline/strip.styles.css.txt?raw";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";

const BASE = "0ad10852bbea850da626b953a594ec6a1b760a63";

// Baseline Token, button and tab styles ship with the observer; U449 supplies the shared layout.
const baseline = [
  { path: "tokens.css", css: baselineTokens },
  // U449 replaces the header and content geometry; compare U441 colours in that layout.
  { path: "styles.css", css: windowStyles.replace(/  color: var\(--text\);\n  background-color: var\(--ground\);/, "") },
  { path: "buttons.css", css: baselineButtons },
  { path: "header/strip.styles.css", css: baselineStrip + stripStyles.slice(stripStyles.indexOf("/* U449:")) },
];

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

Both schemes and normal/more contrast, at 1280×800 with three Projects: rest, hover, selected, selected hover, close hover, pressed, disabled, keyboard focus, rename, overflow and failure/Reopen. The Rail, centre pane, Shelf, Drawer, tooltip and close dialog are measured before and after the contract. U179–U186 interactions run separately; the mark assertions follow U443’s dot.

Each state compares every passing Check on the baseline against the head. A \`-main\` image/check pair uses the baseline styles on the same rendered DOM and interaction state; its unmarked pair uses the head. JSON colour rows retain unrounded composited channels and text/selected contrast readings.

The runtime boxes carry the measured 1 px Token borders. Overflow measurement constrains only the fixture's strip width. U440–U443 geometry and main-revision Check comparisons are captured separately in ../U440/. Dot contrast measures its foreground against the composited ancestor paint.

The current-main D14 Shelf-gap repair stays passing; selected pointer and keyboard press retains every passing baseline Check with the repaired opaque Token. These captures show the webview, not native macOS behaviour.
`);
  }
});

const schemes = ["light", "dark"] as const;

const contrasts = [undefined, "more"] as const;

// Tokens vary by scheme and contrast, so tests walk both; window size and seed stay at one representative case.
const [width, height] = [1280, 800] as const;

// Resolve the actual painted ancestor chain, without rounding alpha channels before luminance.
const PAINT = `selector => {
  const rgb = value => {
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const srgb = /^color\\(srgb ([^)]+)\\)$/.exec(value.trim());
    if (srgb) { const c = srgb[1].split(/[\\s/]+/).filter(Boolean).map(Number); return [c[0] * 255, c[1] * 255, c[2] * 255, c[3] ?? 1]; }
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
    // A filled dot is foreground; its contrast is against the ancestor paint.
    if (node === el && el.matches(".tab-mark")) continue;
    const css = getComputedStyle(node);
    const layer = rgb(css.backgroundColor);
    layers.push({ element: node.className, colour: css.backgroundColor });
    ground = over(layer, ground);
    if (css.backgroundImage !== 'none') {
      const wash = /^linear-gradient\\((rgba?\\([^)]+\\)),\\s*\\1\\)$/.exec(css.backgroundImage);
      const rowWash = node.matches('.rail-row') ? css.backgroundImage.match(/rgba?\\([^)]+\\)/g)?.at(-1) : undefined;
      const colour = rowWash ?? wash?.[1];
      if (!colour) throw new Error('unexpected painted layer ' + css.backgroundImage);
      layers.push({ element: node.className, colour });
      ground = over(rgb(colour), ground);
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

// Measure both dot tones through their shipped Ink rule.
const dots = async () => {
  const red = await paint('.tab-mark');
  await page.call("() => document.querySelector('.tab-mark').dataset.tone = 'amber'");
  const amber = await paint('.tab-mark');
  await page.call("() => document.querySelector('.tab-mark').dataset.tone = 'red'");

  return { red, amber };
};

it("u441_token_checks_do_not_regress", async () => {
  for (const scheme of schemes) for (const contrast of contrasts) {
    await page.scheme(scheme, contrast);

    await three(width, height);
    await page.hover(0, height - 1);
    await useMain(true);
    const before = await readChecks();
    await save(`${scheme}-${contrast ?? 'normal'}-three-${width}x${height}-base`);
    await useMain(false);
    const after = await readChecks();

    for (const id of CHECK_IDS) {
      const check = before[id];

      if (check.status === 'pass') expect(after[id].status, `${scheme}/${contrast}/three/${width}x${height}/${id}: ${JSON.stringify(after[id])}`).toBe('pass');
    }

    await save(`${scheme}-${contrast ?? 'normal'}-three-${width}x${height}-head`, { before, after });
  }
}, 180_000);


it("u441_tab_marks_use_root_ink", async () => {
  for (const scheme of schemes) for (const contrast of contrasts) {
    await page.scheme(scheme, contrast);
    await three();
    const root = await paint('.rail');
    const marks = await dots();
    expect(marks.red.ink).toEqual(root.red);
    expect(marks.amber.ink).toEqual(root.amber);
    await load('tabs-8');
    await page.call(`() => { const sheet = document.createElement('style'); sheet.textContent = '.strip-scroll { max-width: var(--rail-width); }'; document.head.append(sheet); }`);
    await page.until("() => document.querySelector('.strip-edge')");
    const cap = await paint('.strip-edge');
    expect(cap.red).toEqual(root.red);
    expect(cap.amber).toEqual(root.amber);

    for (const tone of ['red', 'amber'] as const) {
      // Strip's scroll measurement can restore its tone between browser calls; sample the fixture in one turn.
      const mark = await page.call<Paint>(`tone => {
        document.querySelector('.strip-edge .tab-mark').dataset.tone = tone;
        return (${PAINT})('.strip-edge .tab-mark');
      }`, tone);

      expect(mark.ink).toEqual(root[tone]);
    }
  }
}, 60_000);

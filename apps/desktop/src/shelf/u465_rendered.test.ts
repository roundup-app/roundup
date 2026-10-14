import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir, readCapture } from "../testing/captures";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";

const exec = promisify(execFile);

let page: ChromePage;

let cache: string;

// One representative case: the densest seed, the only one that reaches the failed add, in the narrowest supported layout.
const [seed, windowWidth, shelfWidth] = ["tree-40", 1280, 240] as const;

const tag = `${seed}-${windowWidth}-light-${shelfWidth}`;

const evaluate = <T,>(script: string): Promise<T> => page.call<T>(`() => (${script})`);

// The page's action timeout for an element or text to appear.
const wait = (predicate: string) => page.until(`() => ${predicate}`, 25_000);

// Shelf.select queues focus; its microtask finishes before the next rendered frame.
const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => resolve(true)))");

// The head harness is the page's own server; `main` serves main's Shelf for capture baselines.
let main: ViteDevServer | undefined;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U465 requires headless Chromium");
  page = await openPage(chrome);
  await page.scheme("light");
  cache = mkdtempSync(join(tmpdir(), "u465-vite-"));

  // CI uses a shallow web checkout; normal checks read the committed main observations.
  if (captureDir("U465")) {
    main = await createServer({ cacheDir: cache, logLevel: "silent", server: { port: 0, hmr: false }, plugins: [{
      name: "u465-main-baseline", enforce: "pre",
      async load(id) {
        const path = ["Shelf.tsx", "styles.css"].find(file => id.split("?")[0]?.endsWith(`/shelf/${file}`));

        if (path) return (await exec("git", ["show", `origin/main:apps/desktop/src/shelf/${path}`])).stdout;
      },
    }] });
    await main.listen();
  }
}, 60_000);

afterAll(async () => {
  await page?.close();
  await main?.close();
  rmSync(cache, { recursive: true, force: true });
});

// Loads `seed` from `server`, or from the page's own head server, in a `windowWidth` by 800 window, once the document has loaded.
const open = async (server: ViteDevServer | undefined, seed: string, width: number, windowWidth: number) => {
  const path = `harness.html?seed=${seed}`;

  await page.load(server ? `${server.resolvedUrls!.local[0]}${path}` : `/${path}`, windowWidth, 800);

  try { await wait("document.readyState === 'complete' && !!document.querySelector('.shelf-tabs')"); } catch (error) { console.error(await evaluate<string>("document.body.outerHTML")); throw error; }

  await evaluate(`(() => { localStorage.clear(); document.querySelector('.window').style.setProperty('--shelf-span', '${width}px'); document.querySelector('#shelf-tab-todos').click(); return true; })()`);
  await settle();
  expect(await evaluate<number>("document.querySelector('.shelf').getBoundingClientRect().width")).toBe(width);
};

const select = async (tab: string) => {
  await evaluate(`(() => { document.querySelector('#shelf-tab-${tab}').click(); return true; })()`);
  await settle();
};

const capture = async (side: "base" | "head", tag: string, checks: Checks) => {
  const dir = captureDir("U465");

  if (!dir) return;

  mkdirSync(join(dir, side), { recursive: true });

  const path = join(dir, side, tag);

  writeFileSync(`${path}.checks.json`, JSON.stringify(checks) + "\n");
  writeFileSync(`${path}.png`, Buffer.from(await page.shot(), "base64"));
};

it("u465_tabs_reuse_the_rail_section_head", async () => {
  await open(undefined, seed, shelfWidth, windowWidth);

  const heads = await evaluate<{ label: string; hidden: string; icon: string; width: number; height: number; font: string; gap: string; spacing: string; capital: string; rule: number }[]>(`[...document.querySelectorAll('.shelf-tab .section-head')].map(head => {
    const icon = head.querySelector('svg'), style = getComputedStyle(head), box = icon.getBoundingClientRect();
    return { label: head.querySelector('span').textContent, hidden: icon.getAttribute('aria-hidden'), icon: icon.innerHTML, width: box.width, height: box.height, font: style.fontSize, gap: style.gap, spacing: style.letterSpacing, capital: style.textTransform, rule: parseFloat(getComputedStyle(head, '::after').width) || 0 };
  })`);

  expect(heads).toHaveLength(2);

  for (const [at, label] of ["Todos", "Pads"].entries()) {
    expect(heads[at]).toMatchObject({ label, hidden: "true", font: "11px", gap: "8px", spacing: "1px", capital: "uppercase", rule: 0 });
    expect([heads[at]!.width, heads[at]!.height]).toEqual([16, 16]);
    expect(heads[at]!.icon).toContain(at === 0 ? "M20 6 9 17l-5-5" : "M16 17H8");
  }
}, 60_000);

it("u465_selection_keeps_full_ink_and_quiet_counts", async () => {
  await open(undefined, seed, shelfWidth, windowWidth);

  for (const selected of ["todos", "pads"]) {
    await select(selected);

    const tones = await evaluate<{ selected: boolean; color: string; icon: string; label: string; expected: string; count: string | null; countColor: string | null; countFont: string | null; background: string; border: string }[]>(`[...document.querySelectorAll('.shelf-tab')].map(tab => {
      const head = tab.querySelector('.section-head'), count = tab.querySelector('.shelf-count'), selected = tab.getAttribute('aria-selected') === 'true';
      const probe = document.createElement('span'); probe.style.color = selected ? 'var(--text)' : 'var(--grey)'; tab.append(probe); const expected = getComputedStyle(probe).color; probe.remove();
      return { selected, color: getComputedStyle(head).color, icon: getComputedStyle(head.querySelector('svg')).color, label: getComputedStyle(head.querySelector('span')).color, expected, count: count?.textContent ?? null, countColor: count ? getComputedStyle(count).color : null, countFont: count ? getComputedStyle(count).fontSize : null, background: getComputedStyle(tab).backgroundColor, border: getComputedStyle(tab).borderWidth };
    })`);

    for (const tone of tones) {
      expect([tone.color, tone.icon, tone.label]).toEqual([tone.expected, tone.expected, tone.expected]);
      expect(tone.background).toBe("rgba(0, 0, 0, 0)");
      expect(tone.border).toBe("0px");

      if (tone.count) {
        expect(tone.countFont).toBe("11px");
        expect(tone.countColor).toBe(tones.find(tab => !tab.selected)!.expected);
      }
    }
  }
}, 60_000);

it("u465_heads_fit_and_keep_button_states", async () => {
  await open(undefined, seed, shelfWidth, windowWidth);

  for (const tab of ["todos", "pads"]) {
    await select(tab);

    const boxes = await evaluate<{ height: number; overlap: boolean; clipped: boolean; focus: string; transition: string }[]>(`(() => {
      const bar = document.querySelector('.shelf-bar').getBoundingClientRect();
      const targets = [...document.querySelectorAll('.shelf-tab, .shelf-toggle')];
      return targets.map((target, at) => {
        target.focus(); const box = target.getBoundingClientRect(), next = targets[at + 1]?.getBoundingClientRect();
        return { height: box.height, overlap: !!next && box.right > next.left, clipped: box.left < bar.left || box.right > bar.right || [...target.querySelectorAll('svg, span')].some(child => { const rect = child.getBoundingClientRect(); return rect.left < box.left || rect.right > box.right; }), focus: getComputedStyle(target).outlineStyle, transition: getComputedStyle(target).transitionDuration };
      });
    })()`);

    for (const box of boxes) {
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.overlap).toBe(false);
      expect(box.clipped).toBe(false);
      expect(box.transition).toBe("0s");
    }

    const position = await evaluate<{ x: number; y: number; left: number; top: number; width: number; height: number }>(`(() => { const box = document.querySelector('#shelf-tab-${tab}').getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2, left: box.left, top: box.top, width: box.width, height: box.height }; })()`);
    const [x, y] = [Math.round(position.x), Math.round(position.y)];

    await page.hover(x, y);
    await settle();
    expect(await evaluate<string>(`getComputedStyle(document.querySelector('#shelf-tab-${tab}')).backgroundColor`), `hover ${tab}`).not.toBe("rgba(0, 0, 0, 0)");
    await page.pointer("down", x, y);
    const pressed = await evaluate<{ background: string; box: number[] }>(`(() => { const target = document.querySelector('#shelf-tab-${tab}'), box = target.getBoundingClientRect(); return { background: getComputedStyle(target).backgroundColor, box: [box.left, box.top, box.width, box.height] }; })()`);
    await page.pointer("up", x, y);
    expect(pressed.background, `pressed ${tab}`).not.toBe("rgba(0, 0, 0, 0)");
    expect(pressed.box).toEqual([position.left, position.top, position.width, position.height]);
    expect(await evaluate<number[]>(`(() => { const box = document.querySelector('#shelf-tab-${tab}').getBoundingClientRect(); return [box.left, box.top, box.width, box.height]; })()`)).toEqual([position.left, position.top, position.width, position.height]);
  }
}, 60_000);

it("u465_heads_preserve_checks_and_visible_failure", async () => {
  const baseline = new Map<string, Checks>();

  for (const side of main ? ["base", "head"] as const : ["head"] as const) {
    await open(side === "base" ? main : undefined, seed, shelfWidth, windowWidth);

    const observe = async (step: string) => {
      const checks = await evaluate<Checks>("window.__checks()");

      if (side === "base") baseline.set(step, checks);
      else {
        const reference: Checks = baseline.get(step) ?? JSON.parse(readCapture("U465", `base/${tag}-${step}.checks.json`));

        for (const id of CHECK_IDS) if (reference[id].status === "pass") expect(checks[id].status, `${tag} ${step} ${id}`).toBe("pass");

        for (const id of ["D2", "D5", "D6"] as const) expect(checks[id].status, `${tag} ${step} ${id}`).toBe("pass");
      }

      await capture(side, `${tag}-${step}`, checks);
    };

    await observe("todos");
    await select("pads");
    await observe("pads");
    await evaluate(`(() => { document.querySelector('#shelf-tab-pads').focus(); return true; })()`);
    await page.press("Home", "Home");
    await settle();
    expect(await evaluate<string>("getComputedStyle(document.activeElement).outlineStyle")).toBe("solid");
    expect(await evaluate<string>("document.activeElement.id")).toBe("shelf-tab-todos");
    await observe("focus");
    await wait(`!!document.querySelector('button[aria-label="Add Todo"]')`);
    const add = await evaluate<{ x: number; y: number }>(`(() => { const button = document.querySelector('button[aria-label="Add Todo"]'); button.scrollIntoView({ block: 'nearest' }); const box = button.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
    await page.click(add.x, add.y);
    await wait(`!!document.querySelector('[aria-label="New Todo title"]')`);
    await evaluate(`(() => { window.__fake.failNext(-32003, 'U465 Todo add failed'); const input = document.querySelector('[aria-label="New Todo title"]'); input.value = 'U465 rejected Todo'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await wait("document.body.innerText.includes('U465 Todo add failed')");
    expect(await evaluate<boolean>(`(() => { const error = [...document.querySelectorAll('.shelf p')].find(node => node.textContent.includes('U465 Todo add failed')); if (!error) return false; const box = error.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.bottom <= 800 && box.top >= 0; })()`)).toBe(true);
    await observe("failure");
  }
}, 120_000);

// Count text is varied independently of list contents to stress the header's fit; 128 is the widest label.
it("u465_large_counts_leave_clearance_for_the_toggle", async () => {
  for (const side of main ? ["base", "head"] as const : ["head"] as const) {
    await open(side === "base" ? main : undefined, seed, shelfWidth, windowWidth);
    await evaluate(`(() => { document.querySelectorAll('.shelf-count').forEach(node => { node.textContent = '128'; }); return true; })()`);
    await settle();

    const fit = await evaluate<{ gap: number; right: number; clipped: boolean }>(`(() => {
      const tabs = [...document.querySelectorAll('.shelf-tab')], toggle = document.querySelector('.shelf-bar .shelf-toggle').getBoundingClientRect();
      return { gap: toggle.left - tabs.at(-1).getBoundingClientRect().right, right: toggle.right,
        clipped: tabs.some(tab => { const box = tab.getBoundingClientRect(); return [...tab.querySelectorAll('svg, span')].some(child => { const rect = child.getBoundingClientRect(); return rect.left < box.left || rect.right > box.right; }); }) };
    })()`);

    expect(fit.gap).toBeGreaterThanOrEqual(8);
    expect(fit.right).toBeLessThanOrEqual(1272);
    expect(fit.clipped).toBe(false);
    await capture(side, `counts-128-${windowWidth}-light-${shelfWidth}`, await evaluate<Checks>("window.__checks()"));
  }
}, 60_000);

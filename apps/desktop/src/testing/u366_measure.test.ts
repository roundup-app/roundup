import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openLog, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

/** U366's observer: the real `rupd` and a real Chromium; the Thread keeps a 120-character measure at 1600 px and fills its pane at 700 px. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

const ART = resolve(process.cwd(), "../../artifacts/ux/U366");

beforeAll(async () => {
  if (!found) throw new Error("U366 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon({}, true);
  page = await openPage(found);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

const BODY = "A long note from the user that goes on and on to see where its lines end and whether the rest of the page stays out of the way. ".repeat(4).slice(0, 400);

type Read = { column: number; pane: number; rem: number; scroll: number; client: number; width: number; limit: number; floor: number; lines: number; longest: number; chars: number; askChars: number; ask: number; maxWidth: string };

const READ = `() => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const body = document.querySelector("[data-message-body]");
  const style = getComputedStyle(body);
  const probe = (ch) => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;visibility:hidden;width:" + ch + "ch;font-family:" + style.fontFamily + ";font-size:" + style.fontSize;
    body.parentElement.append(el);
    const width = el.getBoundingClientRect().width;
    el.remove();
    return width;
  };
  const range = document.createRange();
  range.selectNodeContents(body);
  const rects = [...range.getClientRects()];
  const lines = new Set(rects.map((rect) => Math.round(rect.top))).size;
  const longest = Math.max(...[...new Set(rects.map((rect) => Math.round(rect.top)))].map((top) => {
    const row = rects.filter((rect) => Math.round(rect.top) === top);
    return Math.max(...row.map((rect) => rect.right)) - Math.min(...row.map((rect) => rect.left));
  }));
  // Characters per rendered line, counted one at a time: the ch unit is the width of a zero, which a proportional font undercuts.
  const perLine = (root) => {
    const counts = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.length; i++) {
        const one = document.createRange();
        one.setStart(node, i);
        one.setEnd(node, i + 1);
        const rect = one.getClientRects()[0];
        if (rect && rect.width > 0) counts.set(Math.round(rect.top), (counts.get(Math.round(rect.top)) || 0) + 1);
      }
    }
    return Math.max(0, ...counts.values());
  };
  const column = document.querySelector(".thread-column");
  const ask = document.querySelector(".thread-goal");
  return {
    column: column.getBoundingClientRect().width, pane: column.parentElement.getBoundingClientRect().width, rem,
    scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
    width: body.getBoundingClientRect().width, limit: probe(120), floor: probe(80), lines, longest, chars: perLine(body), askChars: ask ? perLine(ask) : 0,
    ask: ask ? ask.getBoundingClientRect().width : 0, maxWidth: style.maxWidth,
  };
}`;

const save = async (name: string) => {
  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
};

/** A cold dev server may reload the page once it has bundled its dependencies, so the page is loaded again when the rail has not come up. */
const openHarness = async () => {
  for (let attempt = 1; ; attempt++) {
    await page.load(`${real.base}/harness.html?daemon=1`, 1600, 800);

    try {
      await page.until(`() => Boolean(document.querySelector(".rail-actions button"))`, 20_000);

      return;
    } catch (error) {
      if (attempt === 3) throw new Error(`${error instanceof Error ? error.message : String(error)}: ${await page.call<string>(`() => document.body.innerHTML.slice(0, 1500)`)}`);
    }
  }
};

run("u366 the Thread keeps a 120-character measure", () => {
  vi.setConfig({ testTimeout: 120_000 });

  it("u366_a_body_never_exceeds_120ch", async () => {
    await openHarness();
    await page.call(`() => [...document.querySelectorAll("button")].find((each) => each.textContent.includes("new Workstream")).click()`);
    await page.until(`() => { const door = [...document.querySelectorAll("button")].find((each) => /start Door/.test(each.textContent)); door?.click(); return Boolean(document.querySelector('[data-thread-input]')); }`);

    // The input is a controlled textarea: set it through the native setter, then the send button.
    await page.call(
      `(body) => {
        const input = document.querySelector('[data-thread-input]');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, body);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }`,
      BODY,
    );
    await page.until(`() => document.querySelector(".thread-send")?.getAttribute("aria-disabled") !== "true"`);
    await page.call(`() => document.querySelector(".thread-send").click()`);
    await openLog(page);
    await page.until(`() => Boolean(document.querySelector("[data-message-body]"))`);
    await page.until(`() => Boolean(document.querySelector(".thread-more button"))`);
    await page.call(`() => document.querySelector(".thread-more button").click()`);

    const wide = await page.call<Read>(READ);

    expect(wide.maxWidth).not.toBe("none");
    expect(wide.width).toBeLessThanOrEqual(wide.limit + 1);
    expect(wide.longest).toBeGreaterThan(wide.floor);
    expect(wide.lines).toBeGreaterThan(1);
    expect(wide.chars).toBeLessThanOrEqual(120);
    expect(wide.askChars).toBeLessThanOrEqual(120);
    expect(wide.ask).toBeLessThanOrEqual(wide.limit + 1);
    expect(wide.column).toBeGreaterThan(wide.rem * 32);
    await save("thread-1600x800");
  });

  it("u366_the_column_grows_at_1600_and_fills_the_window_at_700", async () => {
    const wide = await page.call<Read>(READ);

    expect(wide.column).toBeGreaterThan(wide.rem * 32);

    await page.resize(700, 800);

    const narrow = await page.call<Read>(READ);

    // Beside the Rail the window's width is the pane's: the column fills it, and nothing scrolls sideways.
    expect(narrow.column).toBeCloseTo(narrow.pane, 0);
    expect(narrow.column).toBeLessThanOrEqual(700);
    expect(narrow.scroll).toBeLessThanOrEqual(narrow.client);
    await save("thread-700x800");
  });
});

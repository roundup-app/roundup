import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import { U445_READ } from "./u445Browser";

type Box = Record<"x" | "y" | "width" | "height", number>;

type Read = {
  before: { box: Box; type: Record<string, string>; lines: string[]; others: Box[] };
  after: { box: Box; type: Record<string, string>; lines: string[]; others: Box[]; lineCount: number; scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number; overflow: string };
};

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U445 needs Chrome: set CHROME_PATH");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

// Repeat only a lost DevTools observation, never a layout assertion. A fresh
// profile also prevents a dead shared page from stalling every later case.
const observe = async <T>(read: () => Promise<T>): Promise<T> => {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof Error) || !/^(Runtime\.|Page\.|Emulation\.).*(timed out|Chrome exited before replying)/.test(error.message)) throw error;

    console.warn(`U445 repeats an observation on fresh Chrome: ${error.message}`);

    await page.close();
    page = await openPage(found!);

    return read();
  }
};

const art = captureDir("U445");

run("u445 real Drawer layout", () => {
  for (const scheme of ["light", "dark"] as const) for (const worst of [false, true]) for (const name of ["title", "body"]) for (const keyboard of [false, true]) {
    // Dark changes only the computed colour, so one edit per field reads it.
    if (scheme === "dark" && (worst || keyboard)) continue;

    const seed = `${name}-${worst ? "worst" : "tree"}-${keyboard ? "enter" : "double-click"}-1280x800-${scheme}`;

    let reading: Promise<Read> | undefined;

    // All three clauses read the same edit, so observe it once per seed.
    const read = () => reading ??= observe(async () => {
      await page.scheme(scheme);
      await page.load("/harness.html?seed=tree-40", 1280, 800);
      await page.until(`() => Boolean(document.querySelector('[data-id="5"] button'))`, 60_000);
      const result = await page.call<Read>(U445_READ, name, worst, keyboard);

      if (art) {
        mkdirSync(art, { recursive: true });
        writeFileSync(join(art, `${seed}.json`), JSON.stringify(result));
      }

      return result;
    });

    it(`u445_${name}_field_matches_shown_${name} ${seed}`, async () => {
      const { before, after } = await read();
      expect(before.box.width).toBeGreaterThan(0);
      expect(before.box.height).toBeGreaterThan(0);

      for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(after.box[key] - before.box[key]), key).toBeLessThanOrEqual(1);
      expect(after.type).toEqual(before.type);
    }, 90_000);
    it(`u445_a_long_title_wraps_as_shown ${seed}`, async () => {
      const { before, after } = await read();
      expect(after.lines).toEqual(before.lines);
      expect(Math.round(after.lineCount)).toBe(before.lines.length);
      expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight);
      expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth);
      expect(after.overflow).toBe("hidden");
    }, 90_000);
    it(`u445_nothing_else_moves ${seed}`, async () => {
      const { before, after } = await read();
      expect(before.others.length).toBeGreaterThan(0);
      expect(after.others).toEqual(before.others);
    }, 90_000);
  }
});

(art ? run : describe.skip)("u445 agent-browser observer", () => {
  for (const scheme of ["light", "dark"]) for (const name of ["title", "body"]) {
    it(`u445_agent_browser_reads_real_boxes ${name}-1280x800-${scheme}`, async () => {
      if (!art) throw new Error("U445 observer needs just capture U445");
      const session = "u445-builder-38459033958-capture";
      const browser = (...args: string[]) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8" });

      try {
        browser("--color-scheme", scheme!, "open", "http://localhost:5199/harness.html?seed=tree-40");
        browser("set", "viewport", "1280", "800");
        browser("set", "media", scheme!);
        const output = JSON.parse(browser("--json", "eval", `(${U445_READ})(${JSON.stringify(name)},true,false)`));
        expect(output.success).toBe(true);
        // SAFETY: U445_READ above defines the shape of this browser result.
        const read = output.data.result as Read;
        expect(read.before.box.width).toBeGreaterThan(0);

        for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(read.before.box[key] - read.after.box[key])).toBeLessThanOrEqual(1);
        expect(read.after.others).toEqual(read.before.others);
        expect(read.after.lines).toEqual(read.before.lines);
        writeFileSync(join(art, `agent-browser-${name}-1280x800-${scheme}.json`), JSON.stringify(output.data.result));
        browser("screenshot", join(art, `agent-browser-${name}-1280x800-${scheme}.png`));
      } finally { browser("close"); }
    }, 90_000);
  }
});

run("u445 real body height follows input", () => {
  it("u445_the_body_grows_and_shrinks_with_its_text", async () => {
    const sizes = await observe(async () => {
      await page.load("/harness.html?seed=tree-40", 1280, 800);
      await page.until(`() => Boolean(document.querySelector('[data-id="5"] button'))`);
      await page.call(U445_READ, "body", true, false);

      return page.call<number[]>(String.raw`() => {
        const field = document.querySelector('[aria-label="Drawer"] textarea');
        const initial = field.getBoundingClientRect().height;
        field.value += '\nnext body line'; field.dispatchEvent(new Event('input', {bubbles:true}));
        const grown = field.getBoundingClientRect().height;
        const noScroll = field.scrollHeight <= field.clientHeight;
        field.value = field.value.slice(0, field.value.lastIndexOf('\n'));
        field.dispatchEvent(new Event('input', {bubbles:true}));
        return [initial, grown, field.getBoundingClientRect().height, noScroll ? 1 : 0];
      }`);
    });

    expect(sizes[1]! - sizes[0]!).toBe(sizes[0]! / 40);
    expect(sizes[2]).toBe(sizes[0]);
    expect(sizes[3]).toBe(1);
  }, 90_000);
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";
import { captureDir } from "./captures";

/** U417's observer: the real `rupd` and a real Chromium; the Thread's composer at rest is two lines tall, centred on send, in the interface font. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

const ART = captureDir("U417");

beforeAll(async () => {
  if (!found) throw new Error("U417 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon({}, true);
  page = await openPage(found);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

type Read = {
  firstLine: number;
  send: number;
  height: number;
  lineHeight: number;
  body: number;
  cap: number;
  padding: string[];
  fontFamily: string;
  hintFamily: string;
  ui: string;
};

const READ = `() => {
  const input = document.querySelector("[data-thread-input]");
  const box = input.getBoundingClientRect();
  const send = document.querySelector(".thread-send").getBoundingClientRect();
  const style = getComputedStyle(input);
  const composer = getComputedStyle(input.closest(".thread-composer"));
  const hint = getComputedStyle(input, "::placeholder");
  const root = getComputedStyle(document.documentElement);
  const lineHeight = parseFloat(style.lineHeight);
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;font-family:" + root.getPropertyValue("--font-ui");
  document.body.append(probe);
  const ui = getComputedStyle(probe).fontFamily;
  probe.remove();
  const rem = parseFloat(root.fontSize);
  const space = (name) => parseFloat(root.getPropertyValue(name)) * (root.getPropertyValue(name).endsWith("rem") ? rem : 1);
  return {
    firstLine: box.top + parseFloat(style.paddingTop) + lineHeight / 2, send: send.top + send.height / 2,
    height: box.height, lineHeight, body: space("--text-body"), cap: parseFloat(style.maxHeight),
    padding: [composer.paddingTop, composer.paddingRight, composer.paddingBottom, composer.paddingLeft],
    fontFamily: style.fontFamily, hintFamily: hint.fontFamily, ui,
  };
}`;

const save = async (name: string) => {
  if (!ART) return;
  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(ART, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`), null, 2));
};

const SET = `(value) => {
  const input = document.querySelector("[data-thread-input]");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input.getBoundingClientRect().height;
}`;

const openComposer = async () => {
  for (let attempt = 1; ; attempt++) {
    await page.load(`${real.base}/harness.html?daemon=1`, 1280, 800);

    try {
      await page.until(`() => Boolean(document.querySelector(".rail-actions button"))`, 20_000);

      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }

  await page.call(`() => [...document.querySelectorAll("button")].find((each) => each.textContent.includes("New Workstream")).click()`);
  await page.until(`() => { const door = [...document.querySelectorAll("button")].find((each) => /Start Door/.test(each.textContent)); door?.click(); return Boolean(document.querySelector('[data-thread-input]')); }`);
};

run("u417 the Thread's composer", () => {
  vi.setConfig({ testTimeout: 120_000 });

  it("u417_the_first_line_and_send_share_one_centre_line", async () => {
    await openComposer();

    for (const [width, name] of [[1280, "rest-1280x800"], [700, "rest-700x800"]] as const) {
      await page.resize(width, 800);

      const read = await page.call<Read>(READ);

      expect(Math.abs(read.firstLine - read.send)).toBeLessThanOrEqual(1);
      await save(name);
    }
  });

  it("u417_the_composer_rests_two_lines_tall_with_even_padding", async () => {
    const read = await page.call<Read>(READ);

    expect(read.height).toBeGreaterThanOrEqual(2 * read.body);
    expect(read.height).toBeGreaterThanOrEqual(2 * read.lineHeight);
    expect(new Set(read.padding).size).toBe(1);
    expect(read.padding[0]).toBe("12px");
  });

  it("u417_the_input_and_its_hint_use_the_interface_font", async () => {
    const read = await page.call<Read>(READ);

    expect(read.fontFamily).toBe(read.ui);
    expect(read.hintFamily).toBe(read.ui);
  });

  it("u417_the_input_still_grows_to_five_lines", async () => {
    const rest = (await page.call<Read>(READ)).height;
    const one = await page.call<number>(SET, "one");
    const two = await page.call<number>(SET, "one\ntwo");
    const six = await page.call<number>(SET, "1\n2\n3\n4\n5\n6");
    const cap = (await page.call<Read>(READ)).cap;

    expect(one).toBeGreaterThanOrEqual(rest);
    expect(two).toBeGreaterThanOrEqual(one);
    expect(six).toBeLessThanOrEqual(cap + 1);
    expect(six).toBeGreaterThan(two);

    await page.call(SET, "");
    await page.call(`() => document.querySelector("[data-thread-input]").focus()`);

    for (const [width, name] of [[1280, "focused-1280x800"], [700, "focused-700x800"]] as const) {
      await page.resize(width, 800);
      await save(name);
    }
  });
});

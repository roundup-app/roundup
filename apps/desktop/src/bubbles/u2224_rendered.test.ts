import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2224 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

type Reading = { shown: number; checks: Record<string, { status: string }> };

const read = `() => ({ shown: document.querySelectorAll('.bubble:not([hidden])').length, checks: window.__checks() })`;

const shoot = async (name: string, reading: Reading): Promise<void> => {
  const dir = captureDir("U2224");

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(reading.checks));
};

it("u2224_one_click_on_an_agent_leaves_no_bubble_over_its_output", async () => {
  for (const scheme of ["light", "dark"] as const) {
    await page.scheme(scheme);
    await page.load("/harness.html?seed=bubbles", 1280, 800);
    await page.until(`() => Boolean(window.__fake)`);
    await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
    await page.until(`() => document.querySelector('.terminal-new')`);
    await page.call(`() => document.querySelector('.terminal-new').click()`);
    await page.until(`() => document.querySelector('.bubble:not([hidden])')`);

    const before = await page.call<Reading>(read);

    expect(before.shown, `${scheme} before`).toBeGreaterThan(0);
    await shoot(`before-${scheme}`, before);
    await page.call(`() => document.querySelector('[data-id="dense"]').click()`);
    await page.until(`() => document.querySelectorAll('.bubble:not([hidden])').length === 0`);

    const after = await page.call<Reading>(read);

    expect(after.shown, `${scheme} after`).toBe(0);

    await shoot(`after-${scheme}`, after);
  }
}, 120_000);

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const art = captureDir("U3010c");

const found = chromePath();

const rendered = art && found ? it : it.skip;

let page: ChromePage;

beforeAll(async () => { if (art && found) page = await openPage(found); }, 90_000);

afterAll(async () => { await page?.close(); });

rendered("u3010c_native_copy_acknowledges_only_the_originating_row", async () => {
  await page.scheme("dark");
  await page.load("/harness.html?seed=tree-40", 1512, 950);
  await page.until(`() => Boolean(document.querySelector('.rail-row[data-id="agent-4"]')) && Boolean(window.__fake)`);
  mkdirSync(art!, { recursive: true });

  const observe = async (name: string) => {
    const state = await page.call(`() => ({ checks: window.__checks(), names: [...document.querySelectorAll('.rail-row .name')].map(el => el.textContent), clipboard: window.__fake.app.clipboardWrites })`);
    writeFileSync(join(art!, `native-copy-${name}.checks.json`), JSON.stringify(state));
    writeFileSync(join(art!, `native-copy-${name}.png`), Buffer.from(await page.shot(), "base64"));
  };

  await observe("initial");
  await page.call(`() => {
    const app = window.__fake.app;
    app.menuChoice = 'copy-link';
    document.querySelector('.rail-row[data-id="agent-4"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  }`);
  await page.until(`() => document.querySelector('.rail-row[data-id="agent-4"] .name')?.textContent === 'Copied'`);
  await observe("acknowledged");
  expect(await page.call<number>(`() => window.__fake.app.clipboardWrites.length`)).toBe(1);
  await page.until(`() => document.querySelector('.rail-row[data-id="agent-4"] .name')?.textContent !== 'Copied'`);
  await page.call(`() => {
    window.__fake.app.clipboardFailure = new Error('Denied; retry.');
    document.querySelector('.rail-row[data-id="agent-4"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  }`);
  await page.until(`() => document.querySelector('.rail-command-notice')?.textContent.includes('Denied; retry.')`);
  await observe("refused");
});

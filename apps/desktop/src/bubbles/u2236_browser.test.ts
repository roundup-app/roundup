import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

let mode: "normal" | "contrast" | "transparency" = "normal";

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2236 requires Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const open = async (): Promise<void> => {
  await page.scheme("dark", mode === "contrast" ? "more" : undefined, mode === "transparency" ? "transparency" : undefined);
  await page.load("/harness.html?seed=bubbles", 1512, 950);
  await page.until(`() => Boolean(window.__fake)`);
  await capture("before");
  await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
  await page.until(`() => document.querySelector('button.terminal-tab')`);
  await page.call(`() => { const tab = document.querySelector('button.terminal-tab'); if (document.querySelector('.bubble')?.hidden) tab.click(); }`);
  await page.until(`() => document.querySelector('.bubble:not([hidden]) .bubble-header') && document.querySelector('.bubble-zone:not([hidden])')`);

  if (captureDir("U2892")) await page.call(`() => new Promise(done => {
    const id = document.querySelector('.bubble:not([hidden])').dataset.bubble;
    window.__fake.writeOutput(id, Array.from({ length: 60 }, (_, index) => 'build step ' + index + ': checking changed files').join('\\r\\n'));
    window.__terminals.get(id).write(new Uint8Array([13, 10]), done);
  })`);
};

it("u2237_fill_and_restore_refit_once", async () => {
  const variants = captureDir("U2892") ? ["normal", "contrast", "transparency"] as const : ["normal"] as const;

  for (const variant of variants) {
    mode = variant;
    await open();

    const header = () => page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('.bubble:not([hidden]) .bubble-name').getBoundingClientRect(); return { x: r.right + 4, y: r.y + r.height / 2 }; }`);
    const sizes = () => page.call<number>(`() => window.__fake.app.calls.filter((call) => call.method === 'terminal.resize').length`);
    const settle = () => page.call(`() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);

    await settle();
    await capture("open");

    const start = await sizes();

    const at = await header();

    await page.doubleClick(at.x, at.y);
    await settle();
    expect(await sizes()).toBe(start + 1);
    await capture("maximised");

    const again = await header();

    await page.doubleClick(again.x, again.y);
    await settle();
    expect(await sizes()).toBe(start + 2);
    await capture("restored");
    expect(await page.call<number>(`() => window.__fake.app.calls.filter((call) => call.method === 'terminal.write').length`)).toBe(0);

    if (captureDir("U2892")) {
      await page.call(`() => document.querySelector('[data-id="runner"]').focus()`);
      await page.press("?", "Slash", 8);
      await page.until(`() => document.querySelector('.help')`);
      await capture("modal-over-bubble");
      await page.press("Escape", "Escape");
      await page.until(`() => !document.querySelector('.help')`);
      await capture("modal-closed");
      await page.call(`() => document.querySelector('.bubble:not([hidden]) button[aria-label="Minimise"]')?.click()`);
      await page.until(`() => !document.querySelector('.bubble:not([hidden])')`);
      await capture("closed");
    }
  }
}, 90_000);

const capture = async (name: string) => {
  const dir = captureDir("U2892");

  if (!dir) return;
  const destination = join(dir, "head");

  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, `${mode}-${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(destination, `${mode}-${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`)));
};

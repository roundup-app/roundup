import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

const run = captureDir("U2892") ? describe : describe.skip;

run("u2892 rendered backdrop and maximised bubble", () => {
  let page: ChromePage;

  beforeAll(async () => {
    const chrome = chromePath();

    if (!chrome) throw new Error("U2892 requires Chromium");
    page = await openPage(chrome);
  }, 90_000);

  afterAll(async () => { await page?.close(); });

  it("u2892_captures_open_and_maximised_bubble", async () => {
    const dir = join(captureDir("U2892") ?? "", "head");

    mkdirSync(dir, { recursive: true });
    await page.scheme("dark");
    await page.load("/harness.html?seed=bubbles", 1280, 800);
    await page.until(`() => Boolean(window.__fake)`);
    await page.call(`() => document.querySelector('[data-id="runner"]').click()`);
    await page.until(`() => document.querySelector('button.terminal-tab')`);
    await page.call(`() => { const tab = document.querySelector('button.terminal-tab'); if (document.querySelector('.bubble')?.hidden) tab.click(); }`);
    await page.until(`() => document.querySelector('.bubble:not([hidden]) .bubble-header')`);

    const step = async (name: string) => {
      writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));

      const checks = await page.call<unknown>(`() => window.__checks()`);

      writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(checks));
      expect(checks).toBeDefined();
    };

    await step("open");

    const at = await page.call<{ x: number; y: number }>(`() => { const r = document.querySelector('.bubble:not([hidden]) .bubble-header').getBoundingClientRect(); return { x: r.left + r.width * 0.85, y: r.top + r.height / 2 }; }`);

    await page.doubleClick(at.x, at.y);
    await page.until(`() => document.querySelector('.bubble:not([hidden])').getBoundingClientRect().width > 600`);
    await step("maximised");
  }, 90_000);
});

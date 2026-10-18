import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U378 requires isolated Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const load = async (seed: string, scheme: "light" | "dark") => {
  await page.scheme(scheme);
  const path = `/harness.html?seed=${seed}`;
  await page.load(path, 1280, 800);
  await page.until(`() => window.__fake`);

  if (seed === "first-run") {
    await page.until(`() => [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Choose folder'))`);
    await page.call(`() => { window.__fake.app.chooser.path='/Users/you/harness'; [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Choose folder')).click(); }`);
  }

  if (seed !== "tree-40") {
    await page.until(`() => document.querySelector('[aria-label="Add Workstream"]') && !document.querySelector('[aria-label="Add Workstream"]').hasAttribute('aria-disabled')`);
    await page.call(`() => document.querySelector('[aria-label="Add Workstream"]').click()`);
  }

  await page.until(`() => document.querySelector('[aria-label="Add Agent"]')`);
  await page.call(`() => document.querySelector('[aria-label="Add Agent"]').closest('.rail-row').focus()`);
};

const FAILURE = "Cannot start Agent: retry with another Model";

const failAdd = async () => {
  await page.call(`() => { window.__fake.failNext(-32602,'${FAILURE}'); document.querySelector('[aria-label="Add Agent"]').click(); }`);
  await page.until(`() => [...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('Cannot start Agent'))`);
};

for (const seed of ["first-run", "agents-10", "tree-40"]) {
  for (const scheme of ["light", "dark"] as const) {
    it(`u378_the_row_renders_one_add ${seed} ${scheme}`, async () => {
      await load(seed, scheme);

      expect(await page.call(`() => document.querySelectorAll('[aria-label="Choose Model and Effort"], .rail-agent-picker, [aria-label="Model"]').length`)).toBe(0);
      await failAdd();
    }, 90_000);
  }
}

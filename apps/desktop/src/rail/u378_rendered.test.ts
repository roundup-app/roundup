import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import { CHECK_IDS, type Checks } from "../testing/checks";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U378 requires isolated Chromium");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const capture = async (name: string) => {
  const dir = captureDir("U378");

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await page.call(`() => window.__checks()`)) + "\n");
};

const load = async (seed: string, scheme: "light" | "dark", base = false) => {
  await page.scheme(scheme);
  const path = `/harness.html?seed=${seed}`;
  await page.load(base ? `${process.env.ROUNDUP_RAIL_BASELINE}${path}` : path, 1280, 800);
  await page.until(`() => window.__fake && typeof window.__checks === 'function'`);

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
      const name = `${seed}-1280-${scheme}`;
      await load(seed, scheme);

      expect(await page.call(`() => document.querySelectorAll('[aria-label="Choose Model and Effort"], .rail-agent-picker, [aria-label="Model"]').length`)).toBe(0);
      await capture(`${name}-closed`);
      await failAdd();
      await capture(`${name}-failed`);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const id of ["D1", "D2", "D5", "D6"] as const) expect(checks[id].status, `${name} failed ${id}: ${JSON.stringify(checks[id])}`).toBe("pass");
    }, 90_000);
  }
}

it("u378_the_add_keeps_design_checks", async () => {
  for (const seed of ["first-run", "agents-10", "tree-40"]) {
    for (const scheme of ["light", "dark"] as const) {
      let baseline: Checks | null = null;
      let failedBaseline: Checks | null = null;

      if (process.env.ROUNDUP_RAIL_BASELINE) {
        await load(seed, scheme, true);
        baseline = await page.call<Checks>(`() => window.__checks()`);
        await failAdd();
        failedBaseline = await page.call<Checks>(`() => window.__checks()`);
      }

      await load(seed, scheme);
      const checks = await page.call<Checks>(`() => window.__checks()`);

      for (const id of ["D1", "D2", "D5", "D6"] as const) expect(checks[id].status, `${seed} ${scheme} ${id}`).toBe("pass");

      if (baseline) for (const id of CHECK_IDS) {
        if (baseline[id].status === "pass") expect(checks[id].status, `${seed} ${id}`).toBe("pass");
      }

      if (failedBaseline) {
        await failAdd();
        const failed = await page.call<Checks>(`() => window.__checks()`);

        for (const id of CHECK_IDS) {
          if (failedBaseline[id].status === "pass") expect(failed[id].status, `${seed} failed ${id}`).toBe("pass");
        }
      }
    }
  }
}, 90_000);

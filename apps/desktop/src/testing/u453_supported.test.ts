import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { CHECK_IDS } from "./checks";
import type { Checks } from "./checks";
import { captureDir, readCapture } from "./captures";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

const stage = process.env.U453_BASE_ROOT ? "base" : "head";

const art = captureDir("U453");

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U453 needs isolated headless Chromium");
  const cwd = process.cwd();

  try {
    if (process.env.U453_BASE_ROOT) process.chdir(join(process.env.U453_BASE_ROOT, "apps/desktop"));
    page = await openPage(found);
  } finally {
    process.chdir(cwd);
  }
}, 90_000);

afterEach(async () => { await page?.call(`() => localStorage.clear()`); });

afterAll(async () => { await page?.close(); });

const settle = async () => {
  // DrawerHost and Shelf expose their finite slide transitions through the Web Animations API.
  await page.until(`() => document.querySelector('.window') && document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect.getTiming().iterations === Infinity)`);
};

const capture = async (name: string, checks: Checks) => {
  if (!art) return;
  const dir = join(art, stage);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(await page.shot(), "base64"));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(checks, null, 2));
};

run("U453 supported App windows", () => {
  vi.setConfig({ testTimeout: 60_000 });

  // Window width is what U453 checks; one scheme represents both.
  const scheme = "light";
  const width = 1280;

  for (const seed of ["first-run", "agents-10", "tree-40", "decisions", "conflict"]) {
    const name = `${seed}-${width}x800-${scheme}`;
    const states = seed === "tree-40" ? ["rest", "todo", "todo-closed", "pad", "pad-closed"] : seed === "decisions" ? ["failed-answer"] : ["rest"];

    for (const state of states) {
      const step = `${name}-${state}`;
      it(`u453_supported_widths_keep_checks ${step}`, async () => {
        await page.scheme(scheme);
        await page.load(`/harness.html?seed=${seed}`, width, 800);

        try {
          await page.until(`() => Boolean(window.__fake && document.querySelector('.window'))`);
        } catch (error) {
          throw new Error(`${step}: ${await page.call<string>(`() => document.body.innerText`)}`, { cause: error });
        }

        await settle();

        if (state.startsWith("todo") || state.startsWith("pad")) {
          if (state.startsWith("pad")) {
            await page.call(`() => [...document.querySelectorAll('.shelf [role=tab]')].find(el => /Pads/i.test(el.textContent)).click()`);
            await page.until(`() => Boolean(document.querySelector('.pad-name'))`);
          }

          await page.call(`(selector) => document.querySelector(selector).click()`, state.startsWith("todo") ? ".todo-row-button" : ".pad-name");
          await page.until(`() => Boolean(document.querySelector('.drawer[data-open="true"]'))`);
          await settle();

          if (state.startsWith("pad")) await page.until(`() => Boolean(document.querySelector('[role="textbox"][aria-label="Pad body"]'))`);

          if (state.endsWith("closed")) {
            await page.call(`() => document.querySelector('.drawer .close').click()`);
            await page.until(`() => !document.querySelector('.drawer[data-open="true"]')`);
            await settle();
          }
        }

        if (state === "failed-answer") {
          await page.call(`() => {
            window.__fake.failNext(-32003, 'Answer failed: ' + 'The permission is still pending. '.repeat(12));
            document.querySelector('.decision-buttons button').click();
          }`);
          await page.until(`() => Boolean(document.querySelector('.decision-card [role=alert]'))`);
        }

        const checks = await page.call<Checks>(`() => window.__checks()`);

        await capture(step, checks);

        if (stage === "base") return;
        // SAFETY: these committed readings were produced by window.__checks on the pinned main revision.
        const base = JSON.parse(readCapture("U453", `base/${step}.checks.json`)) as Checks;

        for (const id of CHECK_IDS) if (base[id].status === "pass") expect(checks[id].status, `${step} ${id}`).toBe("pass");
      });
    }
  }
});

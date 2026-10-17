import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { captureDir } from "./captures";

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = captureDir("U360");

beforeAll(async () => {
  if (!found) throw new Error("U360 needs a Chrome binary: set CHROME_PATH");
  page = await openPage(found);
}, 30_000);

afterAll(async () => page?.close());

run("u360 D14 rendered list rhythm", () => {
  for (const seed of ["tree-40", "agents-10"] as const)
    for (const scheme of ["light", "dark"] as const)
      for (const [width, height] of [[1280, 820], [1280, 800]] as const)
        it(`u360_d14_accepts_the_done_fold_gap_on_${seed}_${scheme}_${width}x${height}`, async () => {
          await page.scheme(scheme);
          await page.load(`/harness.html?seed=${seed}`, width, height);
          await page.until(`() => Boolean(window.__fake) && document.querySelector('.shelf') !== null`);
          await page.call(`async () => {
            window.__fake.actAs({ kind: 'agent', id: 'agent-1', parent: null });
            const app = window.__fake.app;
            await app.rpc('todo.create', { title: 'open one', body: null, blockers: null });
            await app.rpc('todo.create', { title: 'open two', body: null, blockers: null });
            const done = await app.rpc('todo.create', { title: 'finished', body: null, blockers: null });
            await app.rpc('todo.complete', { id: done.id });
          }`);
          await page.until(`() => document.querySelectorAll('.shelf section[aria-label="Todos"] .shelf-list').length === 2`);

          for (const unfolded of [false, true]) {
            if (unfolded) {
              await page.call(`() => document.querySelectorAll('.shelf section[aria-label="Todos"] .shelf-list')[1].querySelector('button').click()`);
              await page.until(`() => document.querySelectorAll('.shelf section[aria-label="Todos"] .shelf-list')[1].querySelectorAll('.shelf-row').length > 1`);
            }

            const result = await page.call<{ checks: Record<string, { status: string }> }>(`() => ({ checks: window.__checks() })`);

            if (ART) {
              mkdirSync(ART, { recursive: true });
              writeFileSync(resolve(ART, `${seed}-${scheme}-${width}x${height}-${unfolded ? "unfolded" : "folded"}.checks.json`), `${JSON.stringify(result)}\n`);
            }

            expect(result.checks.D14).toMatchObject({ status: "pass" });

            for (const id of ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "D16"]) expect(result.checks[id], id).toMatchObject({ status: "pass" });
          }
        }, 30_000);
});

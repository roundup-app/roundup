import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { captureDir } from "./captures";

/** U359 in a real Chromium: D12 to D14 pass on the rendered `todos` and `pads` lists. */

const found = chromePath();

// A missing browser skips only off CI: on CI the claim must be checked, never silently dropped.
const run = found || process.env["CI"] ? describe : describe.skip;

let page: ChromePage;

const ART = captureDir("U359");

/** The observer evidence of U360: each Check's result, per screen. */
const keep = (name: string, value: Readonly<Record<string, { status: string }>>) => {
  if (!ART) return;
  mkdirSync(ART, { recursive: true });
  writeFileSync(resolve(ART, name), `${JSON.stringify(value, null, 2)}\n`);
};

beforeAll(async () => {
  if (!found) throw new Error("U359 needs a Chrome binary: set CHROME_PATH");

  page = await openPage(found);
}, 90_000);

afterAll(async () => {
  await page?.close();
});

const SEEDS = ["tree-40", "agents-10", "first-run"] as const;

/** Page-side: adds the worst-case Todos and Pad (a 300-character title, ten open blockers, a Home that is a Workstream with a 60-character name, a 120-character Pad name) through the fake Daemon, then waits for the rows. */
const WORST = `async () => {
  window.__tab = async (list) => {
    const tab = [...document.querySelectorAll('.shelf [role="tab"]')].find((own) => own.textContent.toLowerCase().startsWith(list));
    if (tab.getAttribute("aria-selected") !== "true") tab.click();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  };
  const app = window.__fake.app;
  // U347: with no Workstream selected the Shelf lists only what a running Agent owns, so \`agent-1\` makes the worst case.
  window.__fake.actAs({ kind: "agent", id: "agent-1", parent: null });
  const first = await app.rpc("todo.create", { title: "w".repeat(300), body: null, blockers: null });
  const blockers = [];
  for (let n = 0; n < 10; n++) blockers.push((await app.rpc("todo.create", { title: "blocker " + n, body: null, blockers: null })).id);
  await app.rpc("todo.create", { title: "blocked by ten", body: null, blockers });
  const home = await app.rpc("rail.createWorkstream", { name: "h".repeat(60), parent: null });
  const homed = await app.rpc("todo.create", { title: "homed in a long workstream", body: null, blockers: null });
  await app.rpc("todo.move", { id: homed.id, home: home.id });
  await app.rpc("pad.create", { name: "p".repeat(120), text: null });
  await new Promise((done) => setTimeout(done, 400));
  return first.id;
}`;

const [scheme, width, height] = ["light", 1280, 800] as const;

run("u359 a Todo row and a Pad row are one designed row", () => {
  vi.setConfig({ testTimeout: 30_000 });

  for (const seed of SEEDS) {
    it(`u359_the_rows_pass_d12_d13_d14 on ${seed} ${scheme} at ${width}x${height}`, async () => {
      await page.scheme(scheme);
      await page.load(`/harness.html?seed=${seed}`, width, height);
      await page.until(`() => document.body.textContent.length > 0 && Boolean(window.__fake)`);

      // The first-run screen has no project, so no Shelf: all three Checks pass with no row to measure.
      if (seed === "first-run") {
        const none = await page.call<Record<string, { status: string }>>(`() => window.__checks()`);

        for (const id of ["D12", "D13", "D14"]) expect(none[id], id).toMatchObject({ status: "pass" });

        keep(`${seed}-${scheme}-${width}x${height}.checks.json`, none);

        return;
      }

      await page.until(`() => document.querySelector(".shelf") !== null`);
      await page.call(WORST);
      await page.call(`() => window.__tab("pads")`);
      await page.until(`() => document.querySelectorAll('.shelf section[aria-label="Pads"] .shelf-row').length > 0`);

      const checks = await page.call<Record<string, { status: string; value: unknown }>>(`() => window.__checks()`);

      for (const id of ["D2", "D12", "D13", "D14"]) expect(checks[id], `${id} ${JSON.stringify(checks[id])}`).toMatchObject({ status: "pass" });

      keep(`${seed}-${scheme}-${width}x${height}.checks.json`, checks);
    });
  }
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { chromePath, FULLSCREEN, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U3707 needs isolated headless Chromium: set CHROME_PATH");
  page = await openPage(chrome);
}, 90_000);

afterAll(async () => { await page?.close(); });

const MODES = [["light", undefined], ["dark", undefined], ["dark", "more"]] as const;

/** Each owned state: the seed, the element to click (null keeps the seed's own selection); the Door row's long name is the longest name seeded. */
const STATES = [
  ["watched-agent", "agents-10", '.rail-row[data-id="agent-1"]'],
  ["door-terminal", "tree-40", '.rail-row[data-id="payments"]'],
  ["door-not-running", "door-stopped", null],
  ["daemon-gone", "daemon-exits", null],
  ["bubble", "door-stopped", ".terminal-new"],
] as const;

const failing = (checks: Checks) => CHECK_IDS.filter((id) => checks[id].status === "fail");

it("u3707_rendered_checks", async () => {
  for (const [scheme, contrast] of MODES) {
    for (const [name, seed, row] of STATES) {
      await page.scheme(scheme, contrast);
      await page.load(`/harness.html?seed=${seed}`, FULLSCREEN.width, FULLSCREEN.height);
      await page.until(`() => Boolean(window.__fake && document.querySelector('.rail-row, .pane'))`);

      if (row) await page.call(`(row) => document.querySelector(row).click()`, row);

      await page.until(`() => Boolean(document.querySelector('.pane'))`);

      if (name === "bubble") await page.until(`() => Boolean(document.querySelector('.bubble:not([hidden]) .xterm-screen'))`);

      const checks = await page.call<Checks>(`() => window.__checks()`);
      const dir = captureDir("U3707");
      const step = `${name}-${scheme}${contrast ? "-contrast" : ""}`;

      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${step}.png`), Buffer.from(await page.shot(), "base64"));
        writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(checks, null, 2));
      }

      expect(failing(checks), step).toEqual([]);
    }
  }
}, 240_000);

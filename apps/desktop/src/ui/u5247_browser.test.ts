import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";
import { appServer, type AppServer } from "../testing/appServer";

// U5247b: the observer for the keyed tooltips' box; looks are the design critic's, so it asserts only that a chip follows the label.
const art = captureDir("U5247b");

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u5247-"));

const session = `u5247-${process.pid}`;

let server: AppServer;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  if (!art) return;
  server = await appServer();
  await browser("--profile", profile, "open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", server.resolvedUrls.local[0]!).href);
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("wait", "--fn", `!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
  await browser("eval", `document.querySelector('#shelf-tab-todos[aria-expanded=false]')?.click()`);
  await browser("wait", "--fn", `!!document.querySelector('.shelf .todo-row-button')`);
  await browser("eval", `document.querySelector('.rail-add').closest('.rail-row').querySelector('.name').click()`);
  await browser("wait", "--fn", `!!document.querySelector('.rail-add[aria-keyshortcuts]')`);
}, 90_000);

afterAll(async () => {
  if (!art) return;

  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

const targets = [
  { name: "maximise", selector: '.shelf-controls button[aria-label="Maximise"]' },
  { name: "triage", selector: '.shelf-triage' },
  { name: "add-agent", selector: '.rail-row .rail-add[aria-keyshortcuts]' },
];

it.skipIf(!art)("u5247b_keyed_tooltips_show_a_chip_after_the_label", async () => {
  mkdirSync(art!, { recursive: true });

  for (const { name, selector } of targets) {
    for (const how of ["hover", "focus"] as const) {
      await browser("eval", `document.activeElement?.blur()`);

      if (how === "hover") await browser("hover", selector);
      else {
        // Ark opens on keyboard focus only: start on the preceding tab stop and press Tab.
        await browser("eval", `(() => { const button = document.querySelector(${JSON.stringify(selector)}); const stops = [...document.querySelectorAll('button,input,textarea,[tabindex="0"]')].filter(el => el.getClientRects().length && !el.disabled); stops[stops.indexOf(button) - 1].focus(); button.id = "u5247-target"; })()`);
        await browser("press", "Tab");
        await browser("wait", "--fn", `document.activeElement?.id === "u5247-target"`);
      }

      await browser("wait", "--fn", `document.querySelector('[role=tooltip][data-state=open]')`);
      // U5247a: the maximise key shows only while the Shelf has focus, so a hover from outside shows the label alone.

      if (name !== "maximise" || how === "focus") expect(await read<number>(`document.querySelectorAll('[role=tooltip][data-state=open] kbd').length`), `${name} ${how}`).toBeGreaterThan(0);
      await browser("screenshot", join(art!, `${name}-${how}.png`));
      writeFileSync(join(art!, `${name}-${how}.checks.json`), JSON.stringify(await read<Checks>("window.__checks()")));
    }
  }
}, 120_000);

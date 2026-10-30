import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";
import { appServer, type AppServer } from "../testing/appServer";

const art = captureDir("U477");

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u474-"));

const session = `u474-${process.pid}`;

let server: AppServer;

let origin: string;

let baselineServer: ViteDevServer | undefined;

let baselineOrigin: string | undefined;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  const baseRoot = process.env.U477_BASE_ROOT;

  if (baseRoot) {
    baselineServer = await createServer({ root: baseRoot, configFile: join(baseRoot, "vite.config.ts"), cacheDir: join(profile, "base"), server: { port: 0, hmr: false }, logLevel: "silent" });
    await baselineServer.listen();
    baselineOrigin = baselineServer.resolvedUrls!.local[0]!;
  }

  await browser("--profile", profile, "open", new URL("/src/ui/u474.html", origin).href);
  await browser("set", "viewport", "1512", "950");

}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); await baselineServer?.close(); rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});


const load = async () => {
  await browser("open", new URL("/src/ui/u474.html", origin).href);
  await browser("wait", "--fn", `!!document.querySelector('[aria-label="Actions taken"]')`);
};

const focus = async (text: string) => browser("wait", "--fn", `document.activeElement?.textContent === ${JSON.stringify(text)}`);

it("u474_dialog_focus_returns", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Open Dialog", "--exact");
  await focus("Cancel");
  expect(await read<string>(`document.getElementById(document.querySelector('[role=dialog]').getAttribute('aria-labelledby')).textContent`)).toBe("Project question");
  expect(await read<string>(`document.getElementById(document.querySelector('[role=dialog]').getAttribute('aria-describedby')).textContent`)).toBe("Keep the Project open?");
  await browser("press", "Tab"); await focus("Keep");
  await browser("press", "Tab"); await focus("Cancel");
  await browser("press", "Shift+Tab"); await focus("Keep");
  await browser("press", "Escape"); await focus("Open Dialog");
}, 60_000);

// App caller inventory: each selector denotes a source occurrence, not one seeded instance.
// Bubbles seed reveals the floating header and terminal bar; tree-40 reveals Todo deletion.
const appIcons = [
  { seed: "bubbles", selector: '.bubble:not([hidden]) .bubble-header button[aria-label="Minimise"]' },
  { seed: "bubbles", selector: '.bubble:not([hidden]) .bubble-header button[aria-label="Close"]' },
  { seed: "bubbles", selector: '.terminal-tab-pair button[data-button="icon"]' },
  { seed: "tree-40", selector: '.todo-delete' },
];

const loadAppIcon = async (base: string, seed: string, selector: string) => {
  await browser("open", new URL(`/harness.html?view=workstreams&items=1&tabs=1&seed=${seed}`, base).href);
  await browser("wait", "--fn", `!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);

  if (seed === "bubbles") {
    await browser("click", '.rail-row[data-id="runner"] .name');
    await browser("wait", "--fn", `document.querySelectorAll('.terminal-tab').length === 3`);

    if (selector.includes('bubble-header')) {
      await browser("eval", `document.querySelector('.terminal-tab[aria-pressed="false"]').click()`);
      await browser("wait", "--fn", `!!document.querySelector('.bubble:not([hidden]) .bubble-header')`);
    }
  }

  if (seed === "tree-40") {
    await browser("eval", `document.querySelector('#shelf-tab-todos[aria-expanded=false]')?.click()`);
    await browser("wait", "--fn", `!!document.querySelector('.shelf .todo-row-button')`);
    await browser("eval", `document.querySelector('.todos-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()`);
    await browser("focus", ".shelf .todo-row-button");
    await browser("press", "Enter");
  }

  await browser("wait", "--fn", `!!document.querySelector(${JSON.stringify(selector)})`);
};

it("u477_app_focus_shows_each_icon_button_name", async () => {
  await browser("set", "media", "dark");

  for (const [index, { seed, selector }] of appIcons.entries()) {
    const capture = async (step: string) => {
      if (!art) return;
      mkdirSync(art, { recursive: true });
      const name = `caller-${index}-focus-${step}`;
      await browser("screenshot", join(art, `${name}.png`));
      writeFileSync(join(art, `${name}.checks.json`), JSON.stringify(await read<Checks>("window.__checks()")));
    };

    if (art && baselineOrigin) {
      await loadAppIcon(baselineOrigin, seed, selector);
      await capture("before");
    }

    await loadAppIcon(origin, seed, selector);
    await browser("eval", `document.querySelector(${JSON.stringify(selector)}).id = "u477-target"`);
    const query = `document.getElementById("u477-target")`;

    // Start on the preceding tab stop, then use browser keyboard navigation.
    await browser("eval", `(() => { const button = ${query}; const stops = [...document.querySelectorAll('button,input,textarea,[tabindex="0"]')].filter(el => el.getClientRects().length && !el.disabled); const previous = stops[stops.indexOf(button) - 1]; previous.id = "u477-previous"; previous.focus(); })()`);
    await browser("wait", "--fn", `document.activeElement?.id === "u477-previous"`);
    await browser("press", "Tab");
    await browser("wait", "--fn", `document.activeElement === ${query}`);
    await browser("wait", "--fn", `${query}.dataset.state === 'open'`);
    expect(await read<boolean>(`document.getElementById(${query}.getAttribute('aria-describedby'))?.getAttribute('role') === 'tooltip'`), selector).toBe(true);
    await capture("after");
  }
}, 120_000);

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

it("u474_alert_dialog_is_named", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Open AlertDialog", "--exact");
  await browser("wait", "--fn", `!!document.querySelector('[role=alertdialog]')`);
  expect(await read<string>(`document.getElementById(document.querySelector('[role=alertdialog]').getAttribute('aria-labelledby')).textContent`)).toBe("Close Project?");
  expect(await read<string>(`document.getElementById(document.querySelector('[role=alertdialog]').getAttribute('aria-describedby')).textContent`)).toBe("Closing stops Agents.");
}, 60_000);

it("u474_menu_keyboard", async () => {
  await load();
  await browser("find", "role", "button", "click", "--name", "Project actions", "--exact");
  await browser("wait", "--fn", `!!document.querySelector('[role=menu]')`);
  await browser("press", "ArrowDown");
  expect(await read<string>(`document.querySelector('[data-highlighted][role=menuitem]').textContent`)).toBe("Open Project");
  await browser("press", "ArrowDown");
  expect(await read<string>(`document.querySelector('[data-highlighted][role=menuitem]').textContent`)).toBe("Close Project");
  await browser("press", "Enter");
  await browser("wait", "--fn", `document.querySelector('output').textContent === '1'`);
  expect(await read<string>(`document.querySelector('output').textContent`)).toBe("1");
  await browser("find", "role", "button", "click", "--name", "Project actions", "--exact");
  await browser("press", "ArrowDown");
  await browser("press", "Escape"); await focus("Project actions");
}, 60_000);

it("u474_tooltip_pointer_and_keyboard", async () => {
  await load();
  await browser("hover", '[data-scope="tooltip"][data-part="trigger"]:not([data-button=icon])');
  await browser("wait", "--fn", `!!document.querySelector('[role=tooltip]')`);
  const linked = `document.getElementById(document.querySelector('[data-scope=tooltip][data-part=trigger]:not([data-button=icon])').getAttribute('aria-describedby'))?.textContent`;
  expect(await read<string>(linked)).toBe("Project contains Agents.");
  await browser("mouse", "move", "1200", "700");
  await browser("wait", "--fn", `![...document.querySelectorAll('[role=tooltip]')].some(el => el.textContent === "Project contains Agents.")`);
  await browser("eval", `document.querySelector('[data-scope=menu][data-part=trigger]').focus()`);
  await browser("press", "Tab");
  await browser("wait", "--fn", `!!document.querySelector('[role=tooltip]')`);
  expect(await read<string>(linked)).toBe("Project contains Agents.");
  await browser("press", "Tab");
  await browser("wait", "--fn", `![...document.querySelectorAll('[role=tooltip]')].some(el => el.textContent === "Project contains Agents.")`);
}, 60_000);

for (const path of ["hover", "focus"] as const) {
  it(`u477_icon_button_${path}_shows_its_name`, async () => {
    await load();
    const selector = '[aria-label="Open Project"]';

    if (path === "hover") await browser("hover", selector);
    else {
      await browser("eval", `document.querySelector('[data-scope=tooltip][data-part=trigger]:not([data-button=icon])').focus()`);
      await browser("press", "Tab");
    }

    await browser("wait", "--fn", `document.getElementById(document.querySelector('${selector}').getAttribute('aria-describedby'))?.getClientRects().length > 0`);
    expect(await read<string>(`document.getElementById(document.querySelector('${selector}').getAttribute('aria-describedby'))?.textContent`)).toBe("Open Project");
    expect(await read<number>(`[...document.querySelectorAll('[role=tooltip]')].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0).length`)).toBe(1);
  }, 60_000);
}

it("u477_icon_button_leave_hides_its_name", async () => {
  await load();
  await browser("hover", '#fixture-icon');
  await browser("wait", "--fn", `document.getElementById('fixture-icon').dataset.state === 'open'`);
  await browser("mouse", "move", "1200", "700");
  await browser("wait", "--fn", `document.getElementById('fixture-icon').dataset.state === 'closed'`);
  expect(await read<string | null>(`document.getElementById('fixture-icon').getAttribute('aria-describedby')`)).toBeNull();
  expect(await read<boolean>(`[...document.querySelectorAll('[role=tooltip]')].some(el => el.textContent === 'Open Project' && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0)`)).toBe(false);
}, 60_000);

it("u477_icon_button_blur_hides_its_name", async () => {
  await load();
  await browser("eval", `document.querySelector('[data-scope=tooltip][data-part=trigger]:not([data-button=icon])').focus()`);
  await browser("press", "Tab");
  await browser("wait", "--fn", `document.getElementById('fixture-icon').dataset.state === 'open'`);
  await browser("press", "Tab");
  await browser("wait", "--fn", `document.getElementById('fixture-icon').dataset.state === 'closed'`);
  expect(await read<string | null>(`document.getElementById('fixture-icon').getAttribute('aria-describedby')`)).toBeNull();
  expect(await read<boolean>(`[...document.querySelectorAll('[role=tooltip]')].some(el => el.textContent === 'Open Project' && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0)`)).toBe(false);
}, 60_000);

it("u477_icon_button_preserves_button_props", async () => {
  await load();
  await browser("click", '#fixture-icon');
  await browser("wait", "--fn", `document.querySelector('output').textContent === '1'`);
  expect(await read<string[]>(`(() => { const button = document.getElementById('fixture-icon'); return [button.dataset.refConnected, button.dataset.fixture, button.getAttribute('aria-expanded'), button.dataset.button]; })()`)).toEqual(["true", "ordinary", "false", "icon"]);
}, 60_000);

it("u477_disabled_icon_button_shows_its_name", async () => {
  await load();
  const selector = '[aria-label="Unavailable action"]';

  for (const path of ["hover", "focus"]) {
    if (path === "hover") await browser("hover", selector);
    else {
      await browser("mouse", "move", "1200", "700");
      await browser("wait", "--fn", `document.querySelector('${selector}').dataset.state === 'closed'`);
      await browser("eval", `document.getElementById('fixture-icon').focus()`);
      await browser("press", "Tab");
    }

    await browser("wait", "--fn", `document.querySelector('${selector}').dataset.state === 'open'`);
    expect(await read<string>(`document.getElementById(document.querySelector('${selector}').getAttribute('aria-describedby'))?.textContent`)).toBe("Unavailable action");
    expect(await read<boolean>(`document.getElementById(document.querySelector('${selector}').getAttribute('aria-describedby')).getClientRects().length > 0`)).toBe(true);
  }
}, 60_000);

it("u477_disabled_icon_button_does_not_act", async () => {
  await load();
  await browser("click", '[aria-label="Unavailable action"]');
  await browser("press", "Enter");
  await browser("press", "Space");
  expect(await read<string>(`document.querySelector('output').textContent`)).toBe("0");
}, 60_000);

it("u477_icon_button_preserves_bound_click_handler", async () => {
  await load();
  await browser("click", '[aria-label="Bound action"]');
  await browser("wait", "--fn", `document.querySelector('output').textContent === '2'`);
  expect(await read<string>(`document.querySelector('output').textContent`)).toBe("2");
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
  await browser("open", new URL(`/harness.html?seed=${seed}`, base).href);
  await browser("wait", "--fn", `!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);

  if (seed === "bubbles") {
    await browser("click", '[data-id="runner"]');
    await browser("wait", "--fn", `document.querySelectorAll('.terminal-tab').length === 3`);

    if (selector.includes('bubble-header')) {
      await browser("eval", `document.querySelector('.terminal-tab[aria-pressed="false"]').click()`);
      await browser("wait", "--fn", `!!document.querySelector('.bubble:not([hidden]) .bubble-header')`);
    }
  }

  if (seed === "tree-40") {
    await browser("eval", `document.querySelector('#shelf-tab-todos').click()`);
    await browser("wait", "--fn", `!!document.querySelector('.shelf .todo-row-button')`);
    await browser("eval", `document.querySelector('.shelf .todo-row-button').click()`);
  }

  await browser("wait", "--fn", `!!document.querySelector(${JSON.stringify(selector)})`);
};

for (const path of ["hover", "focus"] as const) {
  it(`u477_app_${path}_shows_each_icon_button_name`, async () => {
    for (const [index, { seed, selector }] of appIcons.entries()) {
      const capture = async (step: string) => {
        if (!art) return;
        mkdirSync(art, { recursive: true });
        const name = `caller-${index}-${path}-${step}`;
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
      const name = await read<string>(`${query}.getAttribute('aria-label')`);

      if (path === "hover") await browser("hover", "#u477-target");
      else {
        // Start on the preceding tab stop, then use browser keyboard navigation.
        await browser("eval", `(() => { const button = ${query}; const stops = [...document.querySelectorAll('button,input,textarea,[tabindex="0"]')].filter(el => el.getClientRects().length && !el.disabled); const previous = stops[stops.indexOf(button) - 1]; previous.id = "u477-previous"; previous.focus(); })()`);
        await browser("wait", "--fn", `document.activeElement?.id === "u477-previous"`);
        await browser("press", "Tab");
        await browser("wait", "--fn", `document.activeElement === ${query}`);
      }

      await browser("wait", "--fn", `${query}.dataset.state === 'open'`);
      expect(await read<string>(`document.getElementById(${query}.getAttribute('aria-describedby'))?.textContent`), selector).toBe(name);
      expect(await read<boolean>(`(() => { const tip = document.getElementById(${query}.getAttribute('aria-describedby')); return tip?.getAttribute('role') === 'tooltip' && tip.getClientRects().length > 0 && getComputedStyle(tip).visibility !== 'hidden'; })()`), selector).toBe(true);
      await capture("after");
    }
  }, 120_000);
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect } from "vitest";
import { appServer, warmApp, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "tabs-"));

const session = `tabs-${process.pid}-${profile.split("/").at(-1)}`;

let server: AppServer;

let origin: string;

let baselineServer: ViteDevServer | undefined;

let baselineOrigin: string | undefined;

export const browser = async (...args: string[]) => {
  const stdout = (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;
  const reply: { success: boolean; error?: string } = JSON.parse(stdout);

  if (!reply.success) throw new Error(reply.error);

  return stdout;
};

export const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the isolated browser returns the JSON result of the caller's constant expression.
  const reply = JSON.parse(await browser("eval", expression)) as { data: { result: T } };

  return reply.data.result;
};

export const wait = async (expression: string) => browser("wait", "--fn", expression);

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  const baseRoot = process.env.U500_BASE_ROOT;

  if (baseRoot) {
    baselineServer = await createServer({ root: baseRoot, configFile: join(baseRoot, "vite.config.ts"), cacheDir: join(profile, "base-vite"), server: { port: 0, hmr: false }, logLevel: "silent" });
    await baselineServer.listen();
    await warmApp(baselineServer);
    baselineOrigin = baselineServer.resolvedUrls!.local[0]!;
  }

  await browser("--profile", profile, "open", new URL("/src/ui/u498.html", origin).href);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); await baselineServer?.close(); rmSync(profile, { recursive: true, force: true }); }
});

export const load = async (query = "", base = false) => {
  await browser("open", url(`/src/ui/u498.html${query}`, base));
  await wait(`Number(document.querySelector('[data-fixture=tabs]')?.dataset.commit) > 0`);
};

export const action = async (...args: string[]) => {
  const commit = await read<number>(`Number(document.querySelector('[data-fixture=tabs]').dataset.commit)`);

  await browser(...args);
  // The fixture acknowledges document inputs after its render frame; state waits below also await Ark's focus/selection.
  await wait(`Number(document.querySelector('[data-fixture=tabs]').dataset.commit) > ${commit}`);
};

// agent-browser 0.27 role locators use DOM text, including aria-hidden marks; snapshot asserts the accessibility names.
export const click = async (role: string, name: string) => action("find", "role", role, "click", "--name", role === "tab" ? `${name} ·` : name, "--exact");

export const selected = async (name: "Todos" | "Pads", focused = false) => {
  await wait(`document.querySelector('[role=tab][aria-selected=true]')?.textContent.startsWith('${name}') ${focused ? "&& document.activeElement === document.querySelector('[role=tab][aria-selected=true]')" : ""}`);
  expect(await read<unknown>(`(() => {
    const tabs = [...document.querySelectorAll('[role=tab]')];
    const active = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true');
    const panels = [...document.querySelectorAll('[role=tabpanel]')].filter(panel => panel.checkVisibility());
    return { roving: tabs.every(tab => tab.tabIndex === (tab === active[0] ? 0 : -1)), selected: active.length, name: active[0]?.textContent, visible: panels.length, linked: active[0]?.getAttribute('aria-controls') === panels[0]?.id };
  })()`)).toEqual({ roving: true, selected: 1, name: `${name} ·`, visible: 1, linked: true });
};

export const url = (path: string, base = false) => new URL(path, base ? baselineOrigin ?? origin : origin).href;

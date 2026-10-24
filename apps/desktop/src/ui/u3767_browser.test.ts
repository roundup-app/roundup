import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u3767-"));

const session = `u3767-${process.pid}`;

let server: AppServer;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" }, maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();
  await browser("--profile", profile, "open", new URL(new URL("./u3767Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html"), server.resolvedUrls.local[0]!).href);
  await browser("wait", "--fn", `!!document.querySelector('[role="dialog"]')`);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

/** Whether the element at the centre of the surface is inside it, so nothing draws over it. */
const onTop = (surface: string) => read<boolean>(`(() => { const s = document.querySelector('${surface}'); const r = s.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && s.contains(hit); })()`);

it("u3295a_a_menu_or_select_in_a_dialog_shows_above_it", async () => {
  await read(`document.querySelector('[data-scope="menu"][data-part="trigger"]').click()`);
  await browser("wait", "--fn", `!!document.querySelector('.app-menu')`);
  expect(await onTop(".app-menu")).toBe(true);
  await browser("press", "Escape");
  await read(`document.querySelector('.app-select-trigger').click()`);
  await browser("wait", "--fn", `!!document.querySelector('.app-select-list')`);
  expect(await onTop(".app-select-list")).toBe(true);
}, 60_000);

import { agentBrowserExecutable } from "../testing/chromePage";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u475-"));

const session = `u475-${process.pid}`;


let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", origin);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

it.skipIf(!captureDir("U7978a"))("u7978a_header_name_returns_in_its_field_after_reload", async () => {
  const output = captureDir("U7978a")!;
  mkdirSync(output, { recursive: true });
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
  await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
  await browser("eval", "localStorage.clear()");
  await browser("reload");
  await browser("wait", "--fn", "!!document.querySelector('.tab-name') && !!document.querySelector('.rail-row')");
  await browser("eval", "document.querySelector('.tab-name').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))");
  await browser("wait", "--fn", "!!document.querySelector('.tab-rename')");
  await browser("fill", ".tab-rename", "  retained é 🧭 雪  ");
  await browser("eval", "document.querySelector('.tab-rename').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',code:'Escape',bubbles:true,cancelable:true}))");
  await browser("wait", "--fn", "!document.querySelector('.tab-rename')");
  await browser("reload");
  await browser("wait", "--fn", "!!document.querySelector('.tab-name') && !!window.__fake");
  await browser("eval", "document.querySelector('.tab-name').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))");
  await browser("wait", "--fn", "!!document.querySelector('.tab-rename')");
  expect(await read("document.querySelector('.tab-rename').value")).toBe("  retained é 🧭 雪  ");
  await browser("eval", "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await browser("screenshot", join(output, "header-name-returned.png"));
}, 60_000);

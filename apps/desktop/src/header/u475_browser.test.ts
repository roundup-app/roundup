import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  await browser("--profile", profile, "open", origin);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

it.skipIf(!captureDir("P3557c"))("p3557c_header_rendered_failure_before_and_after_clearing", async () => {
  const output = captureDir("P3557c")!;
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
  await browser("fill", ".tab-rename", "  retained é 🧭 雪  ");
  await browser("eval", "document.querySelector('.tab-rename').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',code:'Escape',bubbles:true,cancelable:true}))");
  await browser("wait", "--fn", "!!document.querySelector('.tab-recover') && !document.querySelector('.tab-rename')");
  await browser("click", ".tab-recover");
  await browser("wait", "--fn", "!!document.querySelector('.header-recovery')");
  await browser("eval", "window.__fake.app.clipboardWrite = async () => { throw new Error('Clipboard access denied'); }; [...document.querySelectorAll('.header-recovery button')].find(b => b.textContent === 'Copy name').click()");
  await browser("wait", "--fn", "!!document.querySelector('.header-recovery [role=alert]')");

  const capture = async (step: string) => {
    // Wait for the DOM update to reach a painted frame before recording its pixels.
    await browser("eval", "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await browser("screenshot", join(output, `header-${step}.png`));
    writeFileSync(join(output, `header-${step}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  };

  await capture("failure");
  await browser("click", '[aria-label="Close · Copy name"]');
  await browser("wait", "--fn", "!document.querySelector('.header-recovery [role=alert]')");
  await capture("dismissed");

  await browser("eval", "[...document.querySelectorAll('.header-recovery button')].find(b => b.textContent === 'Copy name').click()");
  await browser("wait", "--fn", "!!document.querySelector('.header-recovery [role=alert]')");
  await browser("eval", "[...document.querySelectorAll('.header-recovery button')].find(b => b.textContent === 'Discard this revision').click()");
  await browser("wait", "--fn", "!document.querySelector('.header-recovery [role=alert]') && !document.querySelector('.draft-value')");
  await capture("discarded");
  await browser("eval", "[...document.querySelectorAll('.header-recovery button')].find(b => b.textContent === 'Close').click()");
  await browser("wait", "--fn", "!document.querySelector('.header-recovery')");
}, 60_000);

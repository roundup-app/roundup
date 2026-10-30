import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, it } from "vitest";
import { waitFor } from "@testing-library/dom";
import { appServer, type AppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

let profile: string;

const session = `unfinished-bubbles-${process.pid}`;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => {
  try {
    return (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 90_000, env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "60000" } })).stdout;
  } catch (error) {
    if (!(error instanceof Error)) throw error;

    throw new Error(`${error.message}\n${"stdout" in error ? String(error.stdout) : ""}\n${"stderr" in error ? String(error.stderr) : ""}`, { cause: error });
  }
};

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser returns this envelope for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

const until = (predicate: string) => waitFor(async () => {
  if (!await read<boolean>(predicate)) throw new Error(`Not observed: ${predicate}`);
}, { timeout: 30_000, interval: 100 });

beforeAll(async () => {
  profile = mkdtempSync(join(tmpdir(), "unfinished-bubbles-"));
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", "about:blank");
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}, 90_000);

const edit = async () => {
  await browser("eval", `document.querySelector('.terminal-tab-name').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`);
  await until(`document.activeElement?.matches('.terminal-tab-editor input')`);
};

const capture = async (step: string, id = "U3021c") => {
  const directory = captureDir(id);

  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await browser("screenshot", join(directory, `${step}.png`));
  writeFileSync(join(directory, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`)) + "\n");
};

const key = async (name: string) => browser("eval", `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(name)},bubbles:true,cancelable:true}))`);

it.skipIf(!captureDir("U3021c") && !captureDir("U3787c"))("u2773e_bubbles_dense_retention_failure_capture", async () => {
  await browser("open", new URL('/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40', origin).href);
  await until(`document.querySelectorAll('.rail-row').length > 2`);
  const denseBefore = await read<unknown[]>(`window.__checks()`);

  await browser("click", '.terminal-new');
  await until(`!!document.querySelector('.terminal-tab-name')`);
  await edit();
  await browser("eval", `(() => { const write = Storage.prototype.setItem; Storage.prototype.setItem = function(key,value) { if(key.startsWith('roundup:drafts:')) throw new Error('observer storage failure'); return write.call(this,key,value); }; })()`);
  await browser("fill", '.terminal-tab-editor input', '  retained failure é 🫧  ');
  await key("Escape");
  await until(`!document.querySelector('.terminal-tab-editor input')`);
  await until(`document.activeElement?.matches('button.terminal-tab')`);
  await browser("click", '[aria-label="Recover unfinished work · Terminal name"]');
  await until(`!!document.querySelector('[role="dialog"] [role="alert"]')`);
  const denseAfter = await read<unknown[]>(`window.__checks()`);

  await capture("dense-retention-failure");
  process.stdout.write(`${JSON.stringify({ denseBefore, denseAfter })}\n`);
}, 60_000);

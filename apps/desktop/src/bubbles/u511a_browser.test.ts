import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { waitFor } from "@testing-library/dom";
import { appServer, type AppServer } from "../testing/appServer";
import { withProjectPair } from "../testing/realDaemonFixture";
import { captureDir } from "../testing/captures";
import { createServedApp } from "../testing/realSeam";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "unfinished-bubbles-"));

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

it("u2773a_bubbles_real_project_reload_and_u2773c_ended_original_recovery", async () => {
  await withProjectPair(async (first, second) => {
    // Await Vite's App-module readiness before Chromium's navigation deadline starts.
    await Promise.all([first, second].map(async project => {
      const ready = await fetch(`${project.base}/__roundup_ready`, { signal: AbortSignal.timeout(60_000) });

      if (!ready.ok) throw new Error(`App preparation failed: ${await ready.text()}`);
    }));
    const app = createServedApp(first.base);
    const other = createServedApp(second.base);
    const opened = await app.rpc("terminal.open", { workstream: null });
    const otherOpened = await other.rpc("terminal.open", { workstream: null });
    const original = (await app.rpc("terminal.list", null)).find(terminal => terminal.id === opened.terminal_id)!;
    const replacement = (await other.rpc("terminal.list", null)).find(terminal => terminal.id === otherOpened.terminal_id)!;

    expect(original.id).toBe(replacement.id);
    expect(original.incarnation).not.toBe(replacement.incarnation);
    await browser("open", `${first.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await until(`!!document.querySelector('.terminal-tab-name')`);
    const before = await read<unknown[]>(`window.__checks()`);

    await edit();
    await browser("fill", '.terminal-tab-editor input', '  exact é 🫧  ');
    await browser("eval", `(() => { const field = document.activeElement; field.setSelectionRange(2,5,'backward'); field.dispatchEvent(new Event('select',{bubbles:true})); })()`);
    await key("Escape");
    await until(`!document.querySelector('.terminal-tab-editor input')`);
    await browser("reload");
    await until(`!!document.querySelector('.terminal-tab-name')`);
    expect(await read<boolean>(`!!document.activeElement?.matches('.terminal-tab-editor input')`)).toBe(false);
    await edit();
    await capture("restored-terminal-name");
    expect(await read<string>(`document.activeElement.value`)).toBe('  exact é 🫧  ');
    expect(await read<unknown[]>(`[document.activeElement.selectionStart,document.activeElement.selectionEnd,document.activeElement.selectionDirection]`)).toEqual([2,5,"backward"]);
    const retainedName = await read<string>(`document.activeElement.value`);
    await key("Escape");
    await until(`!document.querySelector('.terminal-tab-editor input')`);
    await browser("open", `${second.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await until(`!!document.querySelector('.terminal-tab-name')`);
    await edit();
    expect(await read<string>(`document.activeElement.value`)).not.toBe('  exact é 🫧  ');
    await key("Escape");
    await browser("open", `${first.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await until(`!!document.querySelector('.terminal-tab-name')`);
    await app.rpc("terminal.close", { id: original.id });
    await until(`!document.querySelector('.terminal-tab-name')`);
    await browser("click", '[aria-label="Recover unfinished work · Terminal name"]');
    await until(`document.querySelector('[role="dialog"]')?.textContent.includes('Original object unavailable')`);
    expect(await read<string>(`document.querySelector('[role="dialog"] .draft-value').textContent`)).toBe(retainedName);
    const after = await read<unknown[]>(`window.__checks()`);

    expect(await app.rpc("terminal.list", null)).not.toContainEqual(expect.objectContaining({ running: true }));
    await capture("unavailable-original");
    // Retain rendered readings for the run log, never assert layout in behavioral tests.
    process.stdout.write(`${JSON.stringify({ before, after })}\n`);
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
  });
}, 240_000);

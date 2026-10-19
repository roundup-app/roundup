import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "unfinished-bubbles-"));

const session = `unfinished-bubbles-${process.pid}`;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser returns this envelope for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", origin);
  await browser("set", "viewport", "1512", "950");
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const edit = async () => {
  await browser("eval", `document.querySelector('.terminal-tab-name').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`);
  await browser("wait", "--fn", `document.activeElement?.matches('.terminal-tab-editor input')`);
};

const key = async (name: string) => browser("eval", `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(name)},bubbles:true,cancelable:true}))`);

it("u511a_keyboard_context_menu_renames_and_click_away_commits_without_swallowing_the_click", async () => {
  await browser("open", new URL('/harness.html?seed=bubbles', origin).href);
  await browser("wait", "--fn", `!!window.__fake`);
  await browser("click", '[data-id="runner"]');
  await browser("wait", "--fn", `!!document.querySelector('.terminal-tab-name')`);
  await browser("eval", `(() => { const tab = document.querySelector('.terminal-tab'); tab.focus(); tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true })); })()`);
  await browser("wait", "--fn", `!!document.querySelector('[role="menuitem"]')`);
  await browser("click", '[role="menuitem"]');
  await browser("wait", "--fn", `document.activeElement?.matches('.terminal-tab-editor input')`);
  await browser("fill", '.terminal-tab-editor input', 'xy');
  const pressed = await read<string | null>(`document.querySelector('.terminal-tab-pair:nth-child(2) .terminal-tab').getAttribute('aria-pressed')`);

  await browser("click", '.terminal-tab-pair:nth-child(2) .terminal-tab');
  await browser("wait", "--fn", `document.querySelector('.terminal-tab-pair:nth-child(1) .terminal-tab')?.getAttribute('aria-label') === 'xy'`);
  expect(await read<string | null>(`document.querySelector('.terminal-tab-pair:nth-child(2) .terminal-tab').getAttribute('aria-pressed')`)).not.toBe(pressed);
}, 90_000);

it("u2773a_bubbles_real_project_reload_and_u2773c_ended_original_recovery", async () => {
  const first = await startRealDaemon({}, true);
  const second = await startRealDaemon({}, true);

  try {
    const app = createServedApp(first.base);
    const other = createServedApp(second.base);
    const opened = await app.rpc("terminal.open", { workstream: null });
    const otherOpened = await other.rpc("terminal.open", { workstream: null });
    const original = (await app.rpc("terminal.list", null)).find(terminal => terminal.id === opened.terminal_id)!;
    const replacement = (await other.rpc("terminal.list", null)).find(terminal => terminal.id === otherOpened.terminal_id)!;

    expect(original.id).toBe(replacement.id);
    expect(original.incarnation).not.toBe(replacement.incarnation);
    await browser("open", `${first.base}/harness.html?daemon=1`);
    await browser("wait", "--fn", `!!document.querySelector('.terminal-tab-name')`);
    const before = await read<unknown[]>(`window.__checks()`);

    await edit();
    await browser("fill", '.terminal-tab-editor input', '  exact é 🫧  ');
    await browser("eval", `(() => { const field = document.activeElement; field.setSelectionRange(2,5,'backward'); field.dispatchEvent(new Event('select',{bubbles:true})); })()`);
    await key("Escape");
    await browser("wait", "--fn", `!document.querySelector('.terminal-tab-editor input')`);
    await browser("reload");
    await browser("wait", "--fn", `!!document.querySelector('.terminal-tab-name')`);
    expect(await read<boolean>(`!!document.activeElement?.matches('.terminal-tab-editor input')`)).toBe(false);
    await edit();
    expect(await read<string>(`document.activeElement.value`)).toBe('  exact é 🫧  ');
    expect(await read<unknown[]>(`[document.activeElement.selectionStart,document.activeElement.selectionEnd,document.activeElement.selectionDirection]`)).toEqual([2,5,"backward"]);
    await key("Escape");
    await browser("wait", "--fn", `!document.querySelector('.terminal-tab-editor input')`);
    await browser("open", `${second.base}/harness.html?daemon=1`);
    await browser("wait", "--fn", `!!document.querySelector('.terminal-tab-name')`);
    await edit();
    expect(await read<string>(`document.activeElement.value`)).not.toBe('  exact é 🫧  ');
    await key("Escape");
    await browser("open", `${first.base}/harness.html?daemon=1`);
    await browser("wait", "--fn", `!!document.querySelector('.terminal-tab-name')`);
    await app.rpc("terminal.close", { id: original.id });
    await browser("wait", "--fn", `!document.querySelector('.terminal-tab-name')`);
    await browser("click", '[aria-label="Recover unfinished work · Terminal name"]');
    await browser("wait", "--fn", `document.querySelector('[role="dialog"]')?.textContent.includes('Original object unavailable')`);
    expect(await read<string>(`document.querySelector('[role="dialog"] .draft-value').textContent`)).toBe('  exact é 🫧  ');
    const after = await read<unknown[]>(`window.__checks()`);

    expect(await app.rpc("terminal.list", null)).not.toContainEqual(expect.objectContaining({ running: true }));
    await browser("screenshot", "/tmp/u2773-bubbles-recovery.png");
    // Retain rendered readings for the run log, never assert layout in behavioral tests.
    process.stdout.write(`${JSON.stringify({ before, after })}\n`);
  } finally {
    await first.stop();
    await second.stop();
  }
}, 240_000);

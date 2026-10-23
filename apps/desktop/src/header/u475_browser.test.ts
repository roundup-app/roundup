import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

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

it("u2773a_header_restores_exact_work_browser", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("open", new URL("/harness.html?seed=tree-40", origin).href);
  await browser("wait", "--fn", `!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
  await browser("eval", `localStorage.clear()`);
  await browser("reload");
  await browser("wait", "--fn", `!!document.querySelector('.tab-name')`);
  await browser("screenshot", "/tmp/header-before.png");
  await browser("eval", `document.querySelector('.tab-name').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`);
  await browser("wait", "--fn", `!!document.querySelector('.tab-rename')`);
  await browser("eval", `(() => { const field = document.querySelector('.tab-rename'); field.value = '  é 🪁 雪  '; field.dispatchEvent(new Event('input', {bubbles:true})); field.setSelectionRange(2, 6, 'backward'); field.dispatchEvent(new Event('select', {bubbles:true})); field.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); })()`);
  await browser("reload");
  await browser("wait", "--fn", `!!document.querySelector('.tab-name')`);
  await browser("eval", `document.querySelector('.tab-name').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`);
  await browser("wait", "--fn", `!!document.querySelector('.tab-rename')`);
  expect(await read<unknown[]>(`(() => { const field = document.querySelector('.tab-rename'); return [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection, document.activeElement === field]; })()`)).toEqual(['  é 🪁 雪  ', 2, 6, 'backward', true]);
  await browser("eval", `(() => { Storage.prototype.setItem = () => { throw new Error('disk full'); }; const field = document.querySelector('.tab-rename'); field.value = '  newer 雪  '; field.dispatchEvent(new Event('input', {bubbles:true})); field.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); })()`);
  await browser("wait", "--fn", `!!document.querySelector('.tab-recover') && !document.querySelector('.tab-rename')`);
  await browser("eval", `(() => { window.__fake.app.menuChoice = 'recover'; document.querySelector('.todo-project-root').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true})); })()`);
  await browser("wait", "--fn", `!!document.querySelector('[aria-label="Unfinished work"]')`);
  await browser("find", "role", "button", "click", "--name", "Open", "--exact");
  await browser("wait", "--fn", `!document.querySelector('[aria-label="Unfinished work"]')`);
  await browser("click", ".project-tab[data-selected=true] .tab-recover");
  await browser("wait", "--fn", `!!document.querySelector('[role="dialog"]')`);
  expect(await read<boolean>(`!!document.querySelector('[role="dialog"] [role="alert"]')`)).toBe(true);
  await browser("screenshot", "/tmp/header-retention-failure.png");
  expect(await read<string>(`document.querySelector('[role="dialog"] .draft-value').textContent`)).toBe('  newer 雪  ');
  await browser("screenshot", "/tmp/header-recovery.png");
  await browser("eval", `window.__u2773Checks = window.__checks()`);
  console.log("U2773 rendered observer", await read<string>("JSON.stringify(window.__u2773Checks)"));
}, 120_000);

it("u2773a_header_pointer_switch_keeps_caret", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("open", new URL("/harness.html?seed=tabs-8", origin).href);
  await browser("wait", "--fn", `document.querySelectorAll('.project-tab').length === 8`);
  await browser("eval", `localStorage.clear()`);
  await browser("reload");
  await browser("click", '[data-path="/Users/you/project-number-8"] [role="tab"]');
  await browser("dblclick", '[data-path="/Users/you/project-number-8"] .tab-name');
  await browser("fill", ".tab-rename", "retained project name");
  await browser("click", '[data-path="/Users/you/project-number-6"] [role="tab"]');
  await browser("click", '[data-path="/Users/you/project-number-8"] [role="tab"]');
  await browser("dblclick", '[data-path="/Users/you/project-number-8"] .tab-name');
  expect(await read<unknown[]>(`(() => { const field = document.querySelector('.tab-rename'); return [field.value, field.selectionStart, field.selectionEnd]; })()`)).toEqual(["retained project name", 21, 21]);
}, 60_000);


it("u2773e_header_recovery_opens_after_selected_tab_grows", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("open", new URL("/harness.html?seed=tabs-8", origin).href);
  await browser("wait", "--fn", `document.querySelectorAll('.project-tab').length === 8`);
  await browser("eval", `localStorage.clear()`);
  await browser("reload");
  await browser("click", '[data-path="/Users/you/project-number-8"] [role="tab"]');
  await browser("dblclick", '[data-path="/Users/you/project-number-8"] .tab-name');
  await browser("fill", ".tab-rename", "retained project name");
  await browser("press", "Escape");
  await browser("click", '[data-path="/Users/you/project-number-8"] [aria-label^="Recover unfinished work"]');
  await browser("wait", "--fn", `!!document.querySelector('[role="dialog"]')`);
  expect(await read<string>(`document.querySelector('[role="dialog"] .draft-value').textContent`)).toBe("retained project name");
  await browser("press", "Escape");
}, 60_000);

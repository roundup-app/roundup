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

const focused = async (name: string) => browser("wait", "--fn", `document.activeElement?.textContent === ${JSON.stringify(name)}`);

const open = async () => {
  await browser("hover", ".project-tab");
  await browser("eval", `(() => { const opener = document.querySelector('[aria-label^="Close "]'); opener.focus(); opener.click(); })()`);
  await browser("wait", "--fn", `!!document.querySelector('[role="alertdialog"]')`);
  await focused("Cancel");
};

const closed = async () => {
  await browser("wait", "--fn", `!document.querySelector('[role="alertdialog"]') && document.activeElement?.getAttribute('aria-label')?.startsWith('Close ')`);
};

const load = async (scheme: string) => {
  await browser("set", "media", scheme);
  await browser("set", "viewport", "1280", "800");
  await browser("open", new URL("/harness.html?seed=tree-40", origin).href);
  await browser("wait", "--fn", `!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
  await browser("eval", `(() => { window.__u475Calls = []; window.__fake.app.closeProject = async path => { window.__u475Calls.push(path); throw new Error('could not stop rupd'); }; })()`);
};

const stop = async () => browser("find", "role", "button", "click", "--name", "Stop and close", "--exact");

const failure = async () => browser("wait", "--fn", `document.body.textContent.includes('could not stop rupd')`);

// The dialog's focus, dismissal and close calls do not depend on scheme or width, so they run once.
it("u475_close_dialog_cancels", async () => {
  await load("light");

  for (const dismissal of ["Escape", "Cancel", "outside"]) {
    await open();

    if (dismissal === "Escape") await browser("press", "Escape");
    else if (dismissal === "Cancel") await browser("find", "role", "button", "click", "--name", "Cancel", "--exact");
    else {
      await browser("mouse", "move", "10", "400");
      await browser("mouse", "down");
      await browser("mouse", "up");
    }

    await closed();
    expect(await read<unknown[]>("window.__u475Calls"), dismissal).toEqual([]);
  }
}, 90_000);

it("u475_close_dialog_stops_once", async () => {
  await load("light");
  const path = await read<string>(`document.querySelector('.project-tab').dataset.path`);
  await open();
  await stop();
  await failure();
  expect(await read<string[]>("window.__u475Calls")).toEqual([path]);
}, 60_000);

it("u475_close_failure_is_visible", async () => {
  await load("light");
  const path = await read<string>(`document.querySelector('.project-tab').dataset.path`);
  await open();
  await stop();
  await failure();
  expect(await read<string>(`document.querySelector('.project-tab').dataset.path`)).toBe(path);
  expect(await read<boolean>(`[...document.querySelectorAll('*')].some(el => el.textContent === 'could not stop rupd' && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')`)).toBe(true);
}, 60_000);

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
  await browser("wait", "--fn", `!!document.querySelector('.draft-recovery[role=status]')`);
  await browser("screenshot", "/tmp/header-retention-failure.png");
  await browser("eval", `document.querySelector('[aria-label="Recover unfinished work"]').click()`);
  await browser("wait", "--fn", `!!document.querySelector('.draft-recovery .draft-revisions li')`);
  expect(await read<string[]>(`[...document.querySelectorAll('.draft-recovery .draft-revisions li')].map(row => [...row.querySelectorAll('button')].map(button => button.textContent).join('|'))`)).toEqual(['Open|Discard']);
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

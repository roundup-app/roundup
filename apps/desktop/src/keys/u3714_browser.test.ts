import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u3714-"));

const session = `u3714-${process.pid}`;

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
  const ready = await fetch(new URL("/__roundup_ready", origin));

  if (!ready.ok) throw new Error(await ready.text());
  await browser("--profile", profile, "open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const wait = async (expression: string) => browser("wait", "--fn", expression);

const capture = async (id: string, step: string) => {
  const dir = captureDir(id);

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`), null, 2));
};

it("u3714_capture_in_two_chords_on_tree_40", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
  await read(`(() => {
    window.__pointerEvents = 0;
    for (const name of ['pointerdown', 'pointerup', 'click']) document.addEventListener(name, () => window.__pointerEvents++);
    window.__origin = document.querySelector('.rail-row');
    window.__origin.focus();
    window.__selection = document.querySelector('.rail-row[data-selected=true]')?.dataset.id;
  })()`);
  await browser("press", "Meta+k");
  await wait(`!!document.querySelector('.leader')`);
  // Rule 10: u3713_leader_t_opens_a_focused_empty_field_without_changing_selection proves the Capture command; the critic owns its label.
  await browser("press", "t");
  await wait(`document.activeElement === document.querySelector('.capture-field')`);
  expect(await read(`document.querySelector('.rail-row[data-selected=true]')?.dataset.id === window.__selection`)).toBe(true);
  await capture("U3713", "open");
  await browser("keyboard", "type", "keyboard thought");
  await wait(`document.querySelector('.capture-field').value === 'keyboard thought'`);
  await browser("press", "Enter");
  await wait(`!document.querySelector('.capture') && document.activeElement === window.__origin`);
  await wait(`[...document.querySelectorAll('.todo-row')].some(row => row.textContent.includes('keyboard thought'))`);
  expect(await read(`({ pointers: window.__pointerEvents, creates: window.__fake.app.calls.filter(call => call.method === 'todo.create').map(call => call.params) })`)).toEqual({ pointers: 0, creates: [{ title: "keyboard thought", body: null, blockers: null }] });
  await capture("U3714", "filed");

  if (captureDir("T4905")) {
    const dir = captureDir("T4905")!;
    mkdirSync(dir, { recursive: true });
    await browser("record", "start", join(dir, "capture.webm"));
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");

    for (const stage of ["acknowledged", "create", "move"]) {
      await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
      await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
      await browser("click", '.rail-row[data-id="backend"]');
      await wait(`!!document.querySelector('.rail-row[data-id="backend"][data-selected="true"]')`);
      await read(`(async () => {
        const { RpcError } = await import('/src/app/seam.ts');
        const method = ${JSON.stringify(stage)} === 'move' ? 'todo.move' : 'todo.create';
        const original = window.__fake.app.handlers[method];
        window.__fake.app.handlers[method] = params => new Promise((resolve, reject) => {
          window.__settleCapture = () => ${JSON.stringify(stage)} === 'acknowledged'
            ? resolve(original(params))
            : reject(new RpcError(-32003, 'Could not ${stage === "move" ? "move" : "file"} the captured Todo. Try again.'));
        });
      })()`);
      await browser("press", "Meta+k");
      await wait(`!!document.querySelector('.leader')`);
      await browser("press", "t");
      await wait(`document.activeElement === document.querySelector('.capture-field')`);
      await browser("fill", 'textarea[aria-label="Capture a Todo"]', "Captured work to review");
      await browser("press", "Shift+Enter");
      await wait(`typeof window.__settleCapture === 'function' && document.querySelector('textarea[aria-label="Capture a Todo"]').value === ''`);
      await browser("fill", 'textarea[aria-label="Capture a Todo"]', "A newer unfinished thought stays here");
      await wait(`document.querySelector('textarea[aria-label="Capture a Todo"]').value === 'A newer unfinished thought stays here'`);
      await read(`(() => {
        const row = document.querySelector('[data-todo^="-"]');
        row.querySelector('.todo-open')?.click();
        row.querySelector('.todo-row-button').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      })()`);
      await capture("T4905", `${stage}-pending`);
      await read(`window.__settleCapture()`);

      if (stage === "acknowledged") {
        await wait(`!document.querySelector('[data-todo^="-"]') && [...document.querySelectorAll('.todo-open')].some(button => button.getAttribute('aria-label') === 'Open Captured work to review')`);
        await browser("press", "Escape");
        await wait(`!document.querySelector('.capture')`);
        await browser("click", '[aria-label="Open Captured work to review"]');
        await wait(`!!document.querySelector('.drawer[data-open="true"]')`);
      } else {
        await wait(`!!document.querySelector('[aria-label="Recovered capture draft"]') && !!document.querySelector('.capture [role="alert"]')`);
      }

      await capture("T4905", stage);
    }

    await browser("record", "stop");
  }

  if (!captureDir("U3715")) return;
  await read(`window.__fake.failNext(-32003, 'name already taken')`);
  await browser("press", "Meta+k");
  await wait(`!!document.querySelector('.leader')`);
  await browser("press", "t");
  await wait(`document.activeElement === document.querySelector('.capture-field')`);
  await browser("keyboard", "type", "  retained thought  ");
  await wait(`document.querySelector('.capture-field').value === '  retained thought  '`);
  await browser("press", "Enter");
  await wait(`!!document.querySelector('.capture [role=alert]')`);
  await capture("U3715", "failed");
  await browser("press", "Escape");
  await wait(`!document.querySelector('.capture')`);
  await read(`(async () => {
    const { RpcError } = await import('/src/app/seam.ts');
    window.__fake.app.handlers['todo.create'] = () => new Promise((resolve, reject) => {
      window.__rejectCapture = () => reject(new RpcError(-32003, 'could not file the earlier thought'));
    });
  })()`);
  await browser("press", "Meta+k");
  await wait(`!!document.querySelector('.leader')`);
  await browser("press", "t");
  await wait(`document.activeElement === document.querySelector('.capture-field')`);
  await browser("keyboard", "type", "Earlier thought to recover");
  await browser("press", "Shift+Enter");
  await wait(`document.querySelector('.capture-field').value === ''`);
  await browser("keyboard", "type", "A newer thought stays current");
  await read(`window.__rejectCapture()`);
  await wait(`!!document.querySelector('[aria-label="Recovered capture draft"]')`);
  await capture("U3715", "earlier-failure");
  await browser("press", "Shift+Enter");
  await wait(`document.querySelector('.capture-field').value === ''`);
  await capture("U3716", "newer-submitted");

}, captureDir("T4905") ? 180_000 : 60_000);

it("u2773a_capture_restores_exact_text_and_caret_after_webview_reload", async () => {
  await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
  await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
  await browser("press", "Meta+k");
  await wait(`!!document.querySelector('.leader')`);
  await browser("press", "t");
  await wait(`document.activeElement === document.querySelector('.capture-field')`);
  await read(`(() => {
    const field = document.querySelector('.capture-field');
    field.value = '  unfinished é\\n😀  ';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.setSelectionRange(3, 9, 'backward');
    field.dispatchEvent(new Event('select', { bubbles: true }));
  })()`);
  await browser("reload");
  await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
  await browser("press", "Meta+k");
  await wait(`!!document.querySelector('.leader')`);
  await browser("press", "t");
  await wait(`document.activeElement === document.querySelector('.capture-field')`);
  expect(await read(`(() => {
    const field = document.querySelector('.capture-field');
    return { text: field.value, caret: [field.selectionStart, field.selectionEnd, field.selectionDirection], sends: window.__fake.app.calls.filter(call => call.method === 'todo.create').length };
  })()`)).toEqual({ text: "  unfinished é\n😀  ", caret: [3, 9, "backward"], sends: 0 });
}, 60_000);

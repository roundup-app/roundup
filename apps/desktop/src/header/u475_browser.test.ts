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

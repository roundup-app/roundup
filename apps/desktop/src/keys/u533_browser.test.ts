import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u533-"));

const session = `u533-${process.pid}`;

let server: AppServer;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();

  const origin = server.resolvedUrls.local[0]!;
  const ready = await fetch(new URL("/__roundup_ready", origin));

  if (!ready.ok) throw new Error(await ready.text());
  await browser("--profile", profile, "open", new URL("/harness.html?seed=tree-40", origin).href);
  await browser("set", "viewport", "1280", "800");
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

it("u533_message_an_agent_in_two_chords_on_tree_40", async () => {
  await browser("wait", "--fn", `!!window.__fake && !!document.querySelector('.rail-row')`);
  await read(`(() => {
    window.__pointer = 0;
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) window.addEventListener(name, () => { window.__pointer++; }, true);
    window.__calls = window.__fake.app.calls.length;
  })()`);

  // Nothing is selected and the target Agent is 25 rows down.
  expect(await read(`document.querySelector('.rail-row[aria-selected=true]')`)).toBeNull();

  // A chord is one press with a modifier; the text and its Enter are not chords.
  const chords: string[] = [];
  const chord = async (keys: string) => { chords.push(keys); await browser("press", keys); };

  await chord("Meta+k");
  await browser("press", "k");
  await browser("wait", "--fn", `document.activeElement?.closest('.switcher') !== null`);
  await browser("keyboard", "type", "agent-23");
  await browser("wait", "--fn", `document.querySelectorAll('.switcher .app-combobox-item').length === 1`);
  await chord("Shift+Enter");
  await browser("wait", "--fn", `window.__fake.app.calls.some(call => call.method === 'takeover.begin') && !document.querySelector('.pane-watch') && !!document.activeElement?.closest('.pane-screen')`);
  await browser("keyboard", "type", "hello");
  await browser("press", "Enter");
  await browser("wait", "--fn", `window.__fake.app.calls.some(call => call.method === 'terminal.write' && atob(call.params.data).includes('\\r'))`);

  const seen = await read<{ order: string[]; written: string; pointer: number; chords: string[] }>(`(() => {
    const calls = window.__fake.app.calls.slice(window.__calls).filter(call => call.method === 'takeover.begin' || call.method === 'terminal.write');
    return {
      order: calls.map(call => call.method === 'takeover.begin' ? 'takeover.begin ' + call.params.agent : 'terminal.write ' + call.params.id),
      written: calls.filter(call => call.method === 'terminal.write').map(call => atob(call.params.data)).join(''),
      pointer: window.__pointer,
    };
  })()`);

  expect(seen.pointer).toBe(0);
  expect(chords).toEqual(["Meta+k", "Shift+Enter"]);
  expect(seen.written).toBe("hello\r");
  expect(seen.order[0]).toBe("takeover.begin agent-23");
  expect(seen.order.filter((call) => call.startsWith("takeover.begin"))).toHaveLength(1);
  expect(seen.order.slice(1).every((call) => call.startsWith("terminal.write t-agent-23"))).toBe(true);
}, 120_000);

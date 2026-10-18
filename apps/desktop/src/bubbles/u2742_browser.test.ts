import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import type { AppServer } from "../testing/appServer";

const exec = promisify(execFile);
const profile = mkdtempSync(join(tmpdir(), "u2742-"));
const session = `u2742-${process.pid}`;
let server: AppServer;
let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 })).stdout;
const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser owns this result envelope; expressions below are constant harness observations.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };
  if (!reply.success) throw new Error(reply.error);
  return reply.data.result;
};
const wait = async (predicate: string) => { await browser("wait", "--fn", predicate); };
const focused = (id: string) => `document.activeElement?.closest('[data-bubble="${id}"]') !== null`;
const key = async () => { await browser("press", "Meta+b"); };

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", new URL("/harness.html?seed=bubbles", origin).href);
  await browser("set", "viewport", "1512", "950");
}, 90_000);
afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const start = async () => {
  await browser("open", new URL("/harness.html?seed=bubbles", origin).href);
  await wait(`!!window.__fake && !!document.querySelector('[data-id="runner"]')`);
  await read(`document.querySelector('[data-id="runner"]').click()`);
  await wait(`!!document.querySelector('.pane-screen .xterm-helper-textarea') && !!document.querySelector('.terminal-tab[data-bubble="101"]')`);
  // The real Takeover action makes the Agent writable before any switch under test.
  await read(`document.querySelector('.pane-screen .xterm-helper-textarea').focus()`);
  await browser("press", "Meta+Enter");
  await wait(`!document.querySelector('.pane-control[data-state="managed"]') && window.__fake.app.calls.some(c => c.method === 'takeover.begin')`);
  await read(`window.__switchStart = window.__fake.app.calls.length`);
};

it("u2742c_round_trips_type_only_into_the_focused_terminal", async () => {
  await start();
  for (let round = 0; round < 3; round++) {
    await key();
    await wait(focused("103"));
    await browser("keyboard", "type", "bubble");
    await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write' && c.params.id === '103')`);
    await key();
    await wait(`!!document.activeElement?.closest('.pane-screen') && !document.querySelector('.bubble:not([hidden])')`);
    await browser("keyboard", "type", "agent");
    await wait(`window.__fake.app.calls.some(c => c.method === 'terminal.write' && c.params.id === 't-runner')`);
  }
  expect(await read(`(() => {
    const calls = window.__fake.app.calls.slice(window.__switchStart);
    const text = id => calls.filter(c => c.method === 'terminal.write' && c.params.id === id).map(c => atob(c.params.data)).join('');
    return { bubble: text('103'), agent: text('t-runner'), lifecycle: calls.filter(c => ['terminal.open','terminal.close','takeover.begin','takeover.end'].includes(c.method)), selected: document.querySelector('.rail-row[aria-selected=true]')?.dataset.id };
  })()`)).toEqual({ bubble: "bubblebubblebubble", agent: "agentagentagent", lifecycle: [], selected: "runner" });
}, 120_000);

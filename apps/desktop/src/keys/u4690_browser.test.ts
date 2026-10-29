import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u4690-"));

const session = `u4690-${process.pid}`;

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
  mkdirSync(join(dir, step.includes("/") ? step.slice(0, step.lastIndexOf("/")) : ""), { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`), null, 2));
};

const point = async (selector: string) => read<{ x: number; y: number }>(`(() => {
  const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
})()`);

it("u4690b_pointer_down_keeps_the_leader_choice", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
  await read(`window.__hintSource = document.querySelector('.rail-row'); window.__hintSource.focus()`);
  await wait(`!!document.querySelector('.hint-line [data-hint="⌘K"]:enabled')`);
  await capture("U4690e", "head/normal");
  await browser("click", '.hint-line [data-hint="⌘K"]');
  await wait(`!!document.querySelector('.hint-line.leader')`);
  expect(await read(`document.activeElement === window.__hintSource`)).toBe(true);
  await capture("U4690b", "head/armed");
  const target = await point('.hint-line [data-hint="K"]');
  await browser("mouse", "move", String(target.x), String(target.y));
  await browser("mouse", "down", "left");
  expect(await read(`!!document.querySelector('.hint-line.leader [data-hint="K"]') && document.activeElement === window.__hintSource`)).toBe(true);
  await browser("mouse", "up", "left");
  await wait(`!!document.querySelector('.switcher input') && document.activeElement === document.querySelector('.switcher input')`);
  expect(await read(`window.__fake.app.calls.filter(call => call.method === 'terminal.write')`)).toEqual([]);
  await capture("U4690", "head/switcher");
  await browser("press", "Escape");
  await wait(`!document.querySelector('.switcher')`);
}, 60_000);

it("u4690a_pointer_keeps_source_focus_and_action_destinations", async () => {
  await read(`window.__hintSource.focus()`);
  await wait(`!!document.querySelector('.hint-line [data-hint="⌘/"]:enabled')`);
  const target = await point('.hint-line [data-hint="⌘/"]');
  await browser("mouse", "move", String(target.x), String(target.y));
  await browser("mouse", "down", "left");
  expect(await read(`document.activeElement === window.__hintSource`)).toBe(true);
  await browser("mouse", "up", "left");
  await wait(`!!document.activeElement?.closest('.ask-bar')`);
  await capture("U4690a", "head/ask");
}, 60_000);

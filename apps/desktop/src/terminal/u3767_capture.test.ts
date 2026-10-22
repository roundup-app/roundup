import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u3767-capture-"));

const session = `u3767-capture-${process.pid}`;

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
  await browser("--profile", profile, "open", new URL("/harness.html?seed=agents-10", server.resolvedUrls.local[0]!).href);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const wait = async (expression: string) => browser("wait", "--fn", expression);

it("u3767_import_dialog_on_agents_10", async () => {
  const dir = captureDir("U3767");

  if (!dir) return;
  await browser("set", "viewport", "1280", "800");
  await browser("set", "media", "dark");
  await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
  await read(`document.querySelector('.rail-import').click()`);
  await wait(`!!document.querySelector('.import-panel')`);
  expect(await read<boolean>(`document.querySelector('[role="dialog"]').getBoundingClientRect().width > 0`)).toBe(true);
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, "after.png"));
  writeFileSync(join(dir, "after.checks.json"), JSON.stringify(await read(`window.__checks()`), null, 2));
}, 90_000);

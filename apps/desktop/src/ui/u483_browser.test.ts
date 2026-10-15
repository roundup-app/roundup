import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u483-"));

const session = `u483-${process.pid}`;

let server: ViteDevServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await createServer({ cacheDir: join(profile, "vite"), server: { port: 0, hmr: false }, logLevel: "silent" });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!;
  await browser("--profile", profile, "open", new URL("/src/ui/u483.html", origin).href);

}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});


const load = async () => {
  await browser("open", new URL("/src/ui/u483.html", origin).href);
  await browser("wait", "--fn", `!!document.querySelector('[role=tree]')`);
};

it("u483_three_level_keyboard_walk", async () => {
  await load();
  await browser("press", "Tab");
  const at = async (name: string) => {
    await browser("wait", "--fn", `document.activeElement?.closest('[data-id]')?.getAttribute('data-id') === ${JSON.stringify(name)}`);
    expect(await read<string>(`document.activeElement.closest('[data-id]').getAttribute('data-id')`)).toBe(name);
  };
  await at("Alpha");
  for (const [key, name] of [["ArrowRight", "Alpha"], ["ArrowRight", "Beta"], ["ArrowRight", "Beta"], ["ArrowRight", "Cedar"], ["ArrowLeft", "Beta"], ["ArrowLeft", "Beta"], ["ArrowDown", "Delta"], ["ArrowUp", "Beta"], ["ArrowLeft", "Alpha"], ["End", "Echo"], ["Home", "Alpha"], ["e", "Echo"], ["c", "Echo"]]) {
    await browser("press", key!);
    await at(name!);
    if (key === "ArrowRight" && name === "Alpha") expect(await read<string>(`document.querySelector('[data-id=Alpha]').getAttribute('aria-expanded')`)).toBe("true");
    if (key === "ArrowLeft" && name === "Beta") expect(await read<boolean>(`document.querySelector('[data-id=Cedar]').checkVisibility()`)).toBe(false);
  }
}, 90_000);

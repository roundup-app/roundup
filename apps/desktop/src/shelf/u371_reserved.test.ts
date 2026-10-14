import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";

const exec = promisify(execFile);
const profile = mkdtempSync(join(tmpdir(), "u371-browser-"));
const cacheDir = mkdtempSync(join(tmpdir(), "u371-vite-"));
const session = `u371-${process.pid}`;
const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--profile", profile, ...args], { timeout: 60_000 })).stdout;
const evaluate = async <T,>(script: string): Promise<T> => JSON.parse(await browser("eval", script));
let server: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  server = await createServer({ cacheDir, server: { port: 0, hmr: false }, logLevel: "silent" });
  await server.listen();
}, 90_000);
afterAll(async () => {
  await browser("close");
  await server?.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
});
const load = async () => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=tree-40`);
  await browser("wait", ".shelf-tabs");
};
it("u369_the_centre_ends_at_the_shelf_edge", async () => {
  await load();
  const boxes = await evaluate<number[]>(`(() => [document.querySelector('.centre').getBoundingClientRect().right, document.querySelector('.shelf').getBoundingClientRect().left])()`);
  expect(Math.abs(boxes[0]! - boxes[1]!)).toBeLessThanOrEqual(1);
}, 90_000);

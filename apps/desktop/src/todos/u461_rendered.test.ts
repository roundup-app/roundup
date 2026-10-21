import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir } from "../testing/captures";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import { appServer, type AppServer } from "../testing/appServer";

const output = [captureDir("U461") ?? "", captureDir("U462") ?? "", captureDir("U461a") ?? ""];

const run = captureDir("U461") && (captureDir("U462") || captureDir("U461a")) ? describe : describe.skip;

run("u461 and u462 isolated rendered observers", () => {
  let server: AppServer;
  let baseline: ViteDevServer | undefined;
  let cache: string;
  let real: StartedDaemon;

  beforeAll(async () => {
    cache = await mkdtemp(join(tmpdir(), "u461-vite-"));
    server = await appServer();
    const baseRoot = process.env.U461_BASE_ROOT;

    if (baseRoot) {
      baseline = await createServer({ root: baseRoot, configFile: join(baseRoot, "vite.config.ts"), cacheDir: join(cache, "base"), server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "silent" });
      await baseline.listen();
    }

    // E10: the Door's Claude is the pinned one, its model aimock serving this file's turns.
    if (captureDir("U462")) real = await startRealDaemon({}, true, undefined, join(process.cwd(), "src/testing/fixtures/u461_door_todos.json"));
  }, 120_000);

  afterAll(async () => {
    await real?.stop();
    await server?.close();
    await baseline?.close();

    if (cache) await rm(cache, { recursive: true, force: true });
  });

  it.skipIf(!captureDir("U462"))("u461_drawer_rendered_hierarchy", async () => {
    const origin = server.resolvedUrls.local[0]!;

    if (baseline) await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "baseline", baseline.resolvedUrls!.local[0]!, ...output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "fake", origin, ...output], { timeout: 300_000, maxBuffer: 2 * 1024 * 1024 });
  }, 300_000);

  it.skipIf(!captureDir("U462"))("u462_real_daemon_history_and_reads", async () => {
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "real", real.base, ...output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    await real.restart();
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "restart", real.base, ...output], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    await real.model!.assertMatched();
  }, 300_000);
  it.skipIf(!captureDir("U461a"))("u461a_reopen_rendered", async () => {
    await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-fake", server.resolvedUrls.local[0]!, ...output], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  }, 120_000);

  it.skipIf(!captureDir("U461a"))("u461a_real_daemon_user_and_agent_reopen", async () => {
    const reopening = await startRealDaemon({}, true);

    try {
      await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-real", reopening.base, ...output, reopening.dir], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
      await reopening.restart();
      await promisify(execFile)("python3", ["src/todos/u461_browser.test.py", "reopen-restart", reopening.base, ...output], { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
    } finally {
      await reopening.stop();
    }
  }, 240_000);

});

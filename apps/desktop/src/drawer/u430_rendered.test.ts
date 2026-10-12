import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir } from "../testing/captures";

// U430's agent-browser observer runs through just capture U430 (L105), like U445's capture observer.
const run = captureDir("U430") ? describe : describe.skip;

run("u430 rendered centre beside Todo and Pad Drawers", () => {
  let server: ViteDevServer | undefined;
  let cacheDir: string | undefined;

  beforeAll(async () => {
    if (spawnSync("agent-browser", ["--version"], { timeout: 10_000 }).status !== 0) {
      throw new Error("U430 needs agent-browser for isolated headless Chromium");
    }

    // Concurrent Vite optimizers remove one another’s modules when they share a cache.
    cacheDir = mkdtempSync(join(tmpdir(), "u430-vite-"));
    server = await createServer({ cacheDir, server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
    await server.listen();
  }, 90_000);

  afterAll(async () => {
    await server?.close();
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("u430_centre_ends_where_the_drawer_begins_at_supported_stored_widths", async () => {
    const origin = server?.resolvedUrls?.local[0];

    if (!origin) throw new Error("U430 harness has no URL");

    const port = new URL(origin).port;

    await promisify(execFile)("python3", ["src/drawer/u430_browser.test.py", port, "head"], {
      timeout: 360_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  }, 360_000);
});

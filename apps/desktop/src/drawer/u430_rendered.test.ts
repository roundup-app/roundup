import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";

const found = spawnSync("agent-browser", ["--version"]).status === 0;

const run = found || process.env["CI"] ? describe : describe.skip;

let server: ViteDevServer;

beforeAll(async () => {
  if (!found) throw new Error("U430 needs agent-browser for isolated headless Chromium");
  server = await createServer({ server: { port: 0, host: "127.0.0.1", hmr: false }, logLevel: "silent" });
  await server.listen();
}, 90_000);

afterAll(async () => {
  await server?.close();
});

run("u430 rendered centre beside Todo and Pad Drawers", () => {
  it("u430_centre_ends_where_the_drawer_begins_at_supported_stored_widths", async () => {
    const origin = server.resolvedUrls?.local[0];

    if (!origin) throw new Error("U430 harness has no URL");

    const port = new URL(origin).port;

    await promisify(execFile)("python3", ["src/drawer/u430_browser.test.py", port, "head"], {
      timeout: 360_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  }, 360_000);
});

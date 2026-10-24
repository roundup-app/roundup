import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { appServer, type AppServer } from "../testing/appServer";

const output = captureDir("U3760") ?? "";

describe.runIf(Boolean(output))("u3760 isolated rendered observer", () => {
  let server: AppServer;

  beforeAll(async () => { server = await appServer(); }, 120_000);
  afterAll(async () => { await server?.close(); });

  it("u3760_drawer_rendered", async () => {
    const { stdout } = await promisify(execFile)("python3", ["src/todos/u3760_browser.test.py", server.resolvedUrls.local[0]!, output], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });

    expect(stdout).toContain("ok");
  }, 180_000);
});


const lifetimeOutput = captureDir("P3557c") ?? "";

describe.runIf(Boolean(lifetimeOutput))("p3557c isolated rendered observer", () => {
  let server: AppServer;
  beforeAll(async () => { server = await appServer(); }, 120_000);
  afterAll(async () => { await server?.close(); });
  it("p3557c_failure_lifetime_rendered", async () => {
    const { stdout } = await promisify(execFile)("python3", ["src/todos/u3760_browser.test.py", server.resolvedUrls.local[0]!, lifetimeOutput, "P3557c"], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    expect(stdout).toContain("ok");
  }, 180_000);
});

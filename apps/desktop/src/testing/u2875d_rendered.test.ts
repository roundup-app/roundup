import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appServer, type AppServer } from "./appServer";
import { captureDir } from "./captures";
import { CHECK_IDS, type Checks } from "./checks";

const output = captureDir("U2875d");
const run = output ? describe : describe.skip;

run("u2875d isolated rendered import panel", () => {
  let server: AppServer | undefined;
  let records: { step: string; checks: Checks }[] = [];

  beforeAll(async () => {
    server = await appServer();
    const origin = server.resolvedUrls.local[0];

    if (!origin) throw new Error("U2875d harness has no URL");
    const { stdout } = await promisify(execFile)("python3", ["src/testing/u2875d_browser.test.py", origin, output ?? ""], {
      timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    });
    records = JSON.parse(stdout);
  }, 200_000);

  afterAll(async () => { await server?.close(); });

  it("u2875d_dense_import_observes_checks_without_regression", () => {
    expect(records.map(({ step }) => step)).toEqual(["rail", "dense", "partial-failure", "unavailable"]);
    const baseline = records[0]!.checks;

    for (const { step, checks } of records.slice(1)) {
      for (const id of ["D2", "D5", "D6"] as const) expect(checks[id], `${step}: ${id}`).toMatchObject({ status: "pass" });

      for (const id of CHECK_IDS) {
        if (baseline[id].status === "pass") expect(checks[id], `${step}: regression in ${id}`).toMatchObject({ status: "pass" });
      }
    }
  });
});

import { execFile } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as v from "valibot";
import { appServer, type AppServer } from "./appServer";
import { captureDir } from "./captures";
import { CHECK_IDS } from "./checks";

const steps = ["rail", "dense", "partial-failure", "unavailable"] as const;

const observations = v.array(v.object({
  step: v.string(),
  checks: v.record(v.string(), v.object({ status: v.picklist(["pass", "fail"]), value: v.unknown(), selector: v.string() })),
}));

const output = captureDir("U2875d");

const run = output ? describe : describe.skip;

run("u2875d isolated rendered import panel", () => {
  let server: AppServer | undefined;
  let records: v.InferOutput<typeof observations> = [];

  beforeAll(async () => {
    if (!output) throw new Error("U2875d captures are disabled");

    for (const step of steps) rmSync(join(output, `observer-${step}.png`), { force: true });

    server = await appServer();
    const origin = server.resolvedUrls.local[0];

    if (!origin) throw new Error("U2875d harness has no URL");

    const { stdout } = await promisify(execFile)("python3", ["src/testing/u2875d_browser.test.py", origin, output ?? ""], {
      timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    });

    records = v.parse(observations, JSON.parse(stdout));
  }, 200_000);

  afterAll(async () => { await server?.close(); });

  it("u2875d_capture_records_dense_import_without_check_regression", () => {
    expect(records.map(({ step }) => step)).toEqual(steps);

    for (const step of steps) {
      const png = readFileSync(join(output ?? "", `observer-${step}.png`));

      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }

    const baseline = records[0]!.checks;

    for (const { step, checks } of records.slice(1)) {
      for (const id of ["D2", "D5", "D6"] as const) expect(checks[id], `${step}: ${id}`).toMatchObject({ status: "pass" });

      for (const id of CHECK_IDS) {
        if (baseline[id]?.status === "pass") expect(checks[id], `${step}: regression in ${id}`).toMatchObject({ status: "pass" });
      }
    }
  });
});

/** U26: run before Vitest; reuse its browser selection and launcher. Startup measurements: issue-1977.md. */
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromePath, openPage } from "../../apps/desktop/src/testing/chromePage.ts";

type Observation =
  | { call: number; status: "starting" }
  | { call: number; status: "stage"; stage: string; duration_ms: number }
  | { call: number; status: "answered"; duration_ms: number; value: number }
  | { call: number; status: "closed"; duration_ms: number }
  | { call: number; status: "failed"; duration_ms: number; error: string }
  | { status: "failed-command" | "completed"; observation_only: true };

const artifact = process.argv[2];

if (!artifact) throw new Error("cold.mts requires an observation artifact path");

const executable = chromePath();

if (!executable) throw new Error("U26 requires isolated Chromium");

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5_000 }).trim();

const started = performance.now();

const record = (event: Observation) => {
  const row = JSON.stringify({ phase: "concurrent-cold", commit, executable, artifact, elapsed_ms: performance.now() - started, ...event });

  appendFileSync(artifact, `${row}\n`);
  console.log(row);
};

// allSettled retains every error and waits for both owners' teardown. A fast
// failure must not abandon another pending browser or erase its diagnostics.
const results = await Promise.allSettled([0, 1].map(async (call) => {
  record({ call, status: "starting" });

  const began = performance.now();

  try {
    const page = await openPage(executable, { root: fileURLToPath(new URL("../../apps/desktop/", import.meta.url)), observe: (stage, duration_ms) => record({ call, status: "stage", stage, duration_ms }) });

    try {
      const value = await page.call<number>("() => 42");

      if (value !== 42) throw new Error(`U26 cold Chromium returned ${value}, expected 42`);

      record({ call, status: "answered", duration_ms: performance.now() - began, value });
    } finally {
      await page.close();
    }

    record({ call, status: "closed", duration_ms: performance.now() - began });
  } catch (error) {
    console.error(error);
    record({ call, status: "failed", duration_ms: performance.now() - began, error: error instanceof Error ? error.stack ?? error.message : String(error) });
    throw error;
  }
}));

for (const result of results) {
  if (result.status === "rejected") {
    process.exitCode = 1;
  }
}

record({ status: process.exitCode ? "failed-command" : "completed", observation_only: true });

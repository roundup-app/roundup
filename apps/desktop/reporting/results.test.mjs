import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function run(recovered) {
  const result = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "reporting/vite.config.ts"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, ROUNDUP_REPORTING_RECOVERED: recovered ? "1" : "0", NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  const line = result.stdout.split("\n").find((line) => line.startsWith('{"numTotalTestSuites":'));
  assert.ok(line, `missing complete JSON results\n${result.stdout}\n${result.stderr}`);
  return { result, report: JSON.parse(line) };
}

test("L107 completed failures retain per-test evidence for exact recovery", () => {
  const failed = run(false);
  assert.equal(failed.result.status, 1);
  assert.match(failed.result.stdout + failed.result.stderr, /AssertionError/);
  const file = failed.report.testResults[0];
  assert.ok(file.name.endsWith("/reporting/results.fixture.ts"));
  const rows = file.assertionResults;
  assert.equal(rows.length, 5);
  for (const [name, status] of [["fast pass", "passed"], ["separate pass", "passed"], ["exact recovery", "failed"]]) {
    const row = rows.find((row) => row.fullName === `L107 complete desktop results ${name}`);
    assert.ok(row, `missing ${name}`);
    assert.equal(row.status, status);
    assert.equal(typeof row.duration, "number");
    assert.ok(Number.isFinite(row.duration) && row.duration >= 0);
  }
  assert.ok(rows.find((row) => row.title === "fast pass").duration < 300);
  assert.equal(rows.find((row) => row.title === "not executed").status, "pending");
  assert.equal(rows.find((row) => row.title === "pending").status, "todo");
  assert.equal(failed.report.numPassedTests, 2);
  assert.equal(failed.report.numFailedTests, 1);
  assert.equal(failed.report.numPendingTests, 1);
  assert.equal(failed.report.numTodoTests, 1);

  const recovered = run(true);
  assert.equal(recovered.result.status, 0);
  assert.equal(recovered.report.testResults[0].name, file.name);
  const recoveredRows = recovered.report.testResults[0].assertionResults;
  for (const row of rows.filter((row) => ["passed", "failed"].includes(row.status))) {
    const sameTest = recoveredRows.find((next) => next.fullName === row.fullName);
    assert.equal(sameTest?.status, "passed");
    assert.equal(typeof sameTest.duration, "number");
  }
  assert.equal(recovered.report.numPassedTests, 3);
  assert.equal(recovered.report.numFailedTests, 0);
});

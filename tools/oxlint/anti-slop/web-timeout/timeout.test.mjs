import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const plugin = resolve(repo, "tools/oxlint/anti-slop/index.ts");

const exception = {
  file: "fixture.test.tsx", test: "t3779a_real_clock", scenario: "T3779a",
  process: "real clock", reason: "The fixture stands for a named wall-clock observation.", maximum: 90_000,
};

const cases = [
  ["inherited default", 'test("t3779a_default", () => {});', 0],
  ["numeric boundary", 'test("t3779a_limit", () => {}, 60_000);', 0],
  ["over boundary", 'test("t3779a_limit", () => {}, 60_001);', 1, "60001"],
  ["options boundary", 'test("t3779a_limit", { timeout: 60_000 }, () => {});', 0],
  ["options over boundary", 'test("t3779a_limit", { timeout: 60_001 }, () => {});', 1, "60001"],
  ["alias arithmetic", 'const minute = 60 * 1000; check("t3779a_alias", () => {}, minute + 1);', 1, "60001"],
  ["each", 'test.each([1, 2])("t3779a_each %i", () => {}, 60_001);', 1, "60001"],
  ["skip", 'test.skip("t3779a_skip", () => {}, 60_001);', 1, "60001"],
  ["unlimited", 'test("t3779a_zero", () => {}, 0);', 1, "0"],
  ["unresolved", 'test("t3779a_unknown", () => {}, externalTimeout);', 1, "unresolved"],
  ["exact exception", 'test("t3779a_real_clock", () => {}, 90_000);', 0, null, [exception]],
  ["different test", 'test("t3779a_other", () => {}, 90_000);', 1, "90000", [exception]],
  ["exception maximum", 'test("t3779a_real_clock", () => {}, 90_001);', 1, "90001", [exception]],
  ["missing reason", 'test("t3779a_real_clock", () => {}, 90_000);', 1, "exception", [{ ...exception, reason: "" }]],
  ["inherited file timeout", 'vi.setConfig({ testTimeout: 60_001 }); test("t3779a_default", () => {});', 1, "60001"],
  ["inherited suite timeout", 'describe("suite", { timeout: 60_001 }, () => { test("t3779a_default", () => {}); });', 1, "60001"],
  ["explicit overrides inherited", 'vi.setConfig({ testTimeout: 90_000 }); test("t3779a_override", () => {}, 60_000);', 0],
  ["configuration default", 'defineConfig({ test: { testTimeout: 60_001 } });', 1, "60001"],
  ["unresolved config", 'defineConfig({ test: { testTimeout: externalTimeout } });', 1, "unresolved"],
  ["hook and polling bounds", 'beforeAll(() => {}, 90_000); expect.poll(() => 1, { timeout: 90_000 }).toBe(1);', 0],
];

for (const [name, source, status, diagnostic, exceptions = []] of cases) {
  test(`t3779a_timeout_boundary: ${name}`, () => {
    const dir = mkdtempSync(resolve(repo, ".timeout-fixture-"));
    const file = resolve(dir, "fixture.test.tsx");
    const config = resolve(dir, "config.json");
    const entries = exceptions.map(entry => ({ ...entry, file: relative(repo, file) }));
    writeFileSync(file, 'import { test, test as check, describe, vi, beforeAll, expect } from "vitest";\n' + source);
    writeFileSync(config, JSON.stringify({
      jsPlugins: [{ name: "anti-slop", specifier: plugin }],
      rules: { "anti-slop/bounded-test-timeout": ["error", { exceptions: entries }] },
    }));
    try {
      const result = spawnSync("pnpm", ["lint", "--no-ignore", "--config", config, "--format", "json", file], { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, status, result.stdout + result.stderr);
      if (diagnostic) assert.ok(result.stdout.includes(diagnostic), result.stdout);
      if (status === 1) assert.ok(result.stdout.includes("bounded-test-timeout"), result.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

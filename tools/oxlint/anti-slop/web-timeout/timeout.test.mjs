import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const plugin = resolve(repo, "tools/oxlint/anti-slop/index.ts");

const exception = {
  file: "fixture.test.tsx", test: "t3779a_real_clock", scenario: "T3779a",
  observer: "real clock", reason: "The fixture stands for a named wall-clock observation.", maximum: 90_000,
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
  ["unresolved file config", 'vi.setConfig(externalOptions); test("t3779a_default", () => {});', 1, "unresolved"],
  ["inherited file timeout", 'vi.setConfig({ testTimeout: 60_001 }); test("t3779a_default", () => {});', 1, "60001"],
  ["inherited suite timeout", 'describe("suite", { timeout: 60_001 }, () => { test("t3779a_default", () => {}); });', 1, "60001"],
  ["explicit overrides inherited", 'vi.setConfig({ testTimeout: 90_000 }); test("t3779a_override", () => {}, 60_000);', 0],
  ["configuration default", 'defineConfig({ test: { testTimeout: 60_001 } });', 1, "60001"],
  ["unresolved config", 'defineConfig({ test: { testTimeout: externalTimeout } });', 1, "unresolved"],
  ["unknown options", 'test("t3779a_unknown_options", externalOptions, () => {});', 1, "unresolved"],
  ["callback alias", 'const body = () => {}; test("t3779a_callback", body);', 0],
  ["options callback alias", 'const body = () => {}; test("t3779a_callback", { timeout: 60_000 }, body);', 0],
  ["exception in another file", 'test("t3779a_real_clock", () => {}, 90_000);', 1, "90000", [{ ...exception, file: "different.test.tsx" }]],
  ["exception cannot allow unlimited", 'test("t3779a_real_clock", () => {}, 0);', 1, "0", [exception]],
  ["known spread", 'const extra = { retry: 0 }; test("t3779a_spread", { timeout: 60_000, ...extra }, () => {});', 0],
  ["dynamic title cannot match exception", 'test(externalName, () => {}, 90_000);', 1, "90000", [{ ...exception, test: "<dynamic test name>" }]],
  ["namespace", 'import * as v from "vitest"; v.test("t3779a_namespace", () => {}, 60_001);', 1, "60001"],
  ["local test alias", 'const named = test; named("t3779a_alias", () => {}, 60_001);', 1, "60001"],
  ["extended alias", 'const named = test.extend({}); named("t3779a_extended", () => {}, 60_001);', 1, "60001"],
  ["mutable number", 'let duration = 60_000; duration++; test("t3779a_mutable", () => {}, duration);', 1, "unresolved"],
  ["unknown spread", 'test("t3779a_spread", { ...externalOptions }, () => {});', 1, "unresolved"],
  ["spread overridden", 'test("t3779a_spread", { ...externalOptions, timeout: 60_000 }, () => {});', 0],
  ["constant options", 'const options = { timeout: 60_001 }; test("t3779a_options", options, () => {});', 1, "60001"],
  ["unknown constant cycle", 'const a = b; const b = a; test("t3779a_cycle", () => {}, a);', 1, "unresolved"],
  ["finite arithmetic", 'test("t3779a_infinite", () => {}, 1 / 0);', 1, "Infinity"],
  ["negative timeout", 'test("t3779a_negative", () => {}, -1);', 1, "-1"],
  ["same name in another suite", 'describe("other", () => { test("t3779a_real_clock", () => {}, 90_000); });', 1, "90000", [exception]],
  ["each data is not a test", 'test.each("first", "second")("t3779a_each", () => {}, 60_000);', 0],
  ["shadowed function", '{ const test = (a, b, c) => {}; test("unrelated", () => {}, 90_000); }', 0],
  ["hook and polling bounds", 'beforeAll(() => {}, 90_000); expect.poll(() => 1, { timeout: 90_000 }).toBe(1);', 0],
];

for (const [name, source, status, diagnostic, exceptions = []] of cases) {
  test(`t3779a_timeout_boundary: ${name}`, () => {
    const dir = mkdtempSync(resolve(repo, ".timeout-fixture-"));
    const file = resolve(dir, "fixture.test.tsx");
    const config = resolve(dir, "config.json");
    const entries = exceptions.map(entry => ({ ...entry, file: entry.file === "fixture.test.tsx" ? relative(repo, file) : entry.file }));
    writeFileSync(file, 'import { test, test as check, describe, vi, beforeAll, expect } from "vitest";\n' + source);
    writeFileSync(config, JSON.stringify({
      jsPlugins: [{ name: "anti-slop", specifier: plugin }],
      rules: { "anti-slop/bounded-test-timeout": ["error", { exceptions: entries }] },
    }));
    try {
      const result = spawnSync("pnpm", ["--silent", "lint", "--no-ignore", "--config", config, "--format", "json", file], { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, status, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.number_of_files, 1, "The fixture must be linted");
      const diagnostics = report.diagnostics.filter(item => item.code === "anti-slop(bounded-test-timeout)");
      assert.equal(diagnostics.length > 0, status === 1, result.stdout);
      if (diagnostic) assert.ok(diagnostics.some(item => item.message.includes(diagnostic)), result.stdout);
      if (process.env.TIMEOUT_FIXTURE_REPORT) appendFileSync(process.env.TIMEOUT_FIXTURE_REPORT, JSON.stringify({ name, source, exitCode: result.status, diagnostics: diagnostics.map(item => item.message) }) + "\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

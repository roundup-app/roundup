import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const plugin = resolve(repo, "tools/oxlint/anti-slop/index.ts");

const exception = {
  file: "fixture.test.tsx", test: "t3779a_real_clock", scenario: "T3779a",
  observer: "real clock", reason: "The fixture stands for a named wall-clock observation.", maximum: 90_000,
};

const cases = [
  ["destructured suite exact child exception", 'const configured = test.extend({}); const { suite: group } = configured; group("group", { timeout: 90_000 }, () => { test("t3779a_real_clock", () => {}); });', 0, null, [{ ...exception, test: "group > t3779a_real_clock" }]],
  ["destructured suite collector", 'const { describe: group } = test; group("group", { timeout: 90_000 }, () => { test("t3779a_child", () => {}); });', 1, "group > t3779a_child", [{ ...exception, test: "group" }]],
  ["safe default cannot hide unresolved projects", 'defineConfig({ test: { ...externalOptions, testTimeout: 60_000 } });', 1, "unresolved"],
  ["spread overrides safe project list", 'const key = "testTimeout"; const options = { projects: [{ test: { [key]: 60_001 } }] }; defineConfig({ test: { projects: [], ...options } });', 1, "60001"],
  ["safe project list overrides spread", 'const key = "testTimeout"; const options = { projects: [{ test: { [key]: 60_001 } }] }; defineConfig({ test: { ...options, projects: [] } });', 0],
  ["spread unresolved project list", 'const options = { projects: externalProjects }; defineConfig({ test: { ...options } });', 1, "unresolved"],
  ["spread project list timeout", 'const key = "testTimeout"; const options = { projects: [{ test: { [key]: 60_001 } }] }; defineConfig({ test: { ...options } });', 1, "60001"],
  ["test describe cannot grant suite exception", 'test.describe("group", { timeout: 90_000 }, () => { test("t3779a_child", () => {}); });', 1, "group > t3779a_child", [{ ...exception, test: "group" }]],
  ["test suite exact child exception", 'test.suite("group", { timeout: 90_000 }, () => { test("t3779a_real_clock", () => {}); });', 0, null, [{ ...exception, test: "group > t3779a_real_clock" }]],
  ["mutated project list", 'const projects = []; projects.push(externalProject); defineConfig({ test: { projects } });', 1, "unresolved"],
  ["inline project computed timeout", 'const key = "testTimeout"; defineConfig({ test: { projects: [{ test: { [key]: 60_001 } }] } });', 1, "60001"],
  ["inline project unresolved options", 'defineConfig({ test: { projects: [{ test: { ...externalOptions } }] } });', 1, "unresolved"],
  ["unresolved project list", 'defineConfig({ test: { projects: externalProjects } });', 1, "unresolved"],
  ["inline project safe override and paths", 'const projects = ["./packages/*", { test: { ...externalOptions, testTimeout: 60_000 } }]; defineConfig({ test: { projects } });', 0],
  ["exported inline project timeout", 'const key = "testTimeout"; export default { test: { projects: [{ test: { [key]: 60_001 } }] } };', 1, "60001", [], "vitest.config.ts"],
  ["project aliased unresolved default", 'import { defineProject as project } from "vitest/config"; project({ test: { ...externalOptions } });', 1, "unresolved"],
  ["project namespace default", 'import * as config from "vitest/config"; const method = "defineProject"; config[method]({ test: { ...externalOptions } });', 1, "unresolved"],
  ["project destructured default", 'import * as config from "vitest/config"; const { defineProject: project } = config; project({ test: { ...externalOptions } });', 1, "unresolved"],
  ["project exported safe override", 'import { defineProject } from "vitest/config"; const options = defineProject({ test: { ...externalOptions, testTimeout: 60_000, projects: [] } }); export default options;', 0, null, [], "vitest.config.ts"],
  ["project computed default", 'import { defineProject } from "vitest/config"; const key = "testTimeout"; defineProject({ test: { [key]: 60_001 } });', 1, "60001"],
  ["override registration", 'test.override({ value: 1 })("t3779a_override", () => {}, 60_001);', 1, "60001"],
  ["override builder options are fixtures", 'test.override("value", { timeout: 90_000 }, () => 1)("t3779a_limit", () => {}, 60_000);', 0],
  ["override exact exception", 'test.override({ value: 1 })("t3779a_real_clock", () => {}, 90_000);', 0, null, [exception]],
  ["aliased file config", 'const configure = vi.setConfig; configure(externalOptions); test("t3779a_config", () => {});', 1, "unresolved"],
  ["destructured utility config", 'const { setConfig: configure } = vi; configure(externalOptions); test("t3779a_config", () => {});', 1, "unresolved"],
  ["computed utility config alias", 'import * as v from "vitest"; const method = "setConfig"; const configure = v.vi[method]; configure(externalOptions); test("t3779a_config", () => {});', 1, "unresolved"],
  ["aliased file config exception", 'const configure = vi.setConfig; configure({ testTimeout: 90_000 }); test("t3779a_real_clock", () => {});', 0, null, [exception]],
  ["unrelated config alias", 'const other = { setConfig: options => options }; const configure = other.setConfig; configure(externalOptions); test("t3779a_default", () => {});', 0],
  ["namespace computed registration", 'import * as v from "vitest"; const method = "test"; v[method]("t3779a_computed_registration", () => {}, 60_001);', 1, "60001"],
  ["namespace destructured registration", 'import * as v from "vitest"; const { test: named } = v; named("t3779a_destructured", () => {}, 60_001);', 1, "60001"],
  ["destructured file config", 'import * as v from "vitest"; const { vi: clock } = v; clock.setConfig(externalOptions); test("t3779a_config", () => {});', 1, "unresolved"],
  ["destructured configuration helper", 'import * as v from "vitest/config"; const { defineConfig: config } = v; config({ test: { ...externalOptions } });', 1, "unresolved"],
  ["destructured namespace boundary", 'import * as v from "vitest"; const { test: named } = v; named("t3779a_destructured", () => {}, 60_000);', 0],
  ["unrelated destructured registration", 'const other = { test: (a, b, c) => {} }; const { test: named } = other; named("unrelated", () => {}, 90_000);', 0],
  ["exported spread configuration", 'export default { ...externalOptions };', 1, "unresolved", [], "vite.config.ts"],
  ["exported computed configuration", 'const key = "test"; export default { [key]: { [externalKey]: 90_000 } };', 1, "unresolved", [], "vitest.config.mts"],
  ["exported configuration alias", 'const options = { test: { ...externalOptions } }; export default options;', 1, "unresolved", [], "vitest.config.ts"],
  ["exported safe override", 'export default { ...externalOptions, test: { testTimeout: 60_000 } };', 0, null, [], "vite.config.ts"],
  ["exported defineConfig alias", 'const options = defineConfig({ test: { testTimeout: 60_000 } }); export default options;', 0, null, [], "vitest.config.ts"],
  ["exported inherited default", 'export default { test: { retry: 0 } };', 0, null, [], "vitest.config.ts"],
  ["unrelated default export", 'export default { ...externalOptions };', 0],
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
  ["computed configuration default", 'const key = "testTimeout"; defineConfig({ test: { [key]: 60_001 } });', 1, "60001"],
  ["unresolved configuration key", 'defineConfig({ test: { [externalKey]: 90_000 } });', 1, "unresolved"],
  ["configuration spread", 'defineConfig({ test: { ...externalOptions } });', 1, "unresolved"],
  ["root configuration spread", 'defineConfig({ ...externalOptions });', 1, "unresolved"],
  ["mutated configuration alias", 'const options = { testTimeout: 60_000 }; options.testTimeout++; defineConfig({ test: options });', 1, "unresolved"],
  ["configuration spread overrides default", 'defineConfig({ test: { testTimeout: 60_000, ...externalOptions } });', 1, "unresolved"],
  ["configuration default overrides spread", 'defineConfig({ test: { ...externalOptions, testTimeout: 60_000, projects: [] } });', 0],
  ["root test overrides spread", 'defineConfig({ ...externalOptions, test: { testTimeout: 60_000 } });', 0],
  ["configuration without timeout", 'defineConfig({ test: { retry: 0 } });', 0],
  ["immutable configuration alias", 'const options = { test: { testTimeout: 60_000 } }; defineConfig(options);', 0],
  ["configuration import alias", 'import { defineConfig as config } from "vitest/config"; config({ test: { ...externalOptions } });', 1, "unresolved"],
  ["configuration namespace", 'import * as config from "vitest/config"; config.defineConfig({ test: { ...externalOptions } });', 1, "unresolved"],
  ["unrelated configuration function", '{ const defineConfig = options => options; defineConfig({ ...externalOptions }); }', 0],
  ["unknown options", 'test("t3779a_unknown_options", externalOptions, () => {});', 1, "unresolved"],
  ["callback alias", 'const body = () => {}; test("t3779a_callback", body);', 0],
  ["options callback alias", 'const body = () => {}; test("t3779a_callback", { timeout: 60_000 }, body);', 0],
  ["exception in another file", 'test("t3779a_real_clock", () => {}, 90_000);', 1, "90000", [{ ...exception, file: "different.test.tsx" }]],
  ["exception cannot allow unlimited", 'test("t3779a_real_clock", () => {}, 0);', 1, "0", [exception]],
  ["unresolved computed key", 'test("t3779a_computed", { [externalKey]: 90_000 }, () => {});', 1, "unresolved"],
  ["mutated options", 'const options = { timeout: 60_000 }; options.timeout = 90_000; test("t3779a_mutated", options, () => {});', 1, "unresolved"],
  ["aliased mutation", 'const options = { timeout: 60_000 }; const alias = options; alias.timeout++; test("t3779a_alias_write", options, () => {});', 1, "unresolved"],
  ["method mutation", 'const options = { timeout: 60_000, reset() { this.timeout = 90_000; } }; options.reset(); test("t3779a_method_write", options, () => {});', 1, "unresolved"],
  ["escaped options", 'const options = { timeout: 60_000 }; mutate(options); test("t3779a_escaped", options, () => {});', 1, "unresolved"],
  ["inherited options without timeout", 'const options = { retry: 0 }; vi.setConfig(options); test("t3779a_default", options, () => {});', 0],
  ["known computed key", 'const key = "timeout"; test("t3779a_computed", { [key]: 60_000 }, () => {});', 0],
  ["computed key overridden", 'test("t3779a_override", { [externalKey]: 90_000, timeout: 60_000 }, () => {});', 0],
  ["unresolved config overridden", 'vi.setConfig(externalOptions); test("t3779a_override", () => {}, 60_000);', 0],
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

for (const [name, source, status, diagnostic, exceptions = [], filename = "fixture.test.tsx"] of cases) {
  test(`t3779a_timeout_boundary: ${name}`, () => {
    const dir = mkdtempSync(resolve(tmpdir(), ".timeout-fixture-"));
    const file = resolve(dir, filename);
    const config = resolve(dir, "config.json");
    const entries = exceptions.map(entry => ({ ...entry, file: entry.file === "fixture.test.tsx" ? relative(dir, file) : entry.file }));
    // CI run 41006963235 spent 40 minutes re-auditing the repo for these fixtures.
    // Keep the real lint entry point, with only this synthetic project as its root.
    writeFileSync(resolve(dir, "package.json"), JSON.stringify({ scripts: { lint: `node ${resolve(repo, "tools/oxlint/anti-slop/web-assertions/lint.mjs")}` } }));
    writeFileSync(file, 'import { test, test as check, describe, vi, beforeAll, expect } from "vitest";\n' + source);
    writeFileSync(config, JSON.stringify({
      jsPlugins: [{ name: "anti-slop", specifier: plugin }],
      rules: { "anti-slop/bounded-test-timeout": ["error", { exceptions: entries }] },
    }));
    try {
      const result = spawnSync("pnpm", ["--dir", dir, "--silent", "lint", "--no-ignore", "--config", config, "--format", "json", file], { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, status, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.number_of_files, 1, "The fixture must be linted");
      const diagnostics = report.diagnostics.filter(item => item.code === "anti-slop(bounded-test-timeout)");
      assert.equal(diagnostics.length > 0, status === 1, result.stdout);
      if (diagnostic) assert.ok(diagnostics.some(item => item.message.includes(diagnostic)), result.stdout);
      if (process.env.TIMEOUT_FIXTURE_REPORT) appendFileSync(process.env.TIMEOUT_FIXTURE_REPORT, JSON.stringify({ name, filename, source, exitCode: result.status, diagnostics: diagnostics.map(item => item.message) }) + "\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

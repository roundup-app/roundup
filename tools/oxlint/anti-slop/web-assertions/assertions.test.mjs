import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = "tools/oxlint/anti-slop/web-assertions";
const lint = resolve(repo, directory, "lint.mjs");
const plugin = resolve(repo, "tools/oxlint/anti-slop/index.ts");
const cases = [
  ["computed style", 'expect(getComputedStyle(element).color).toBe("red");', "appearance"],
  ["geometry", 'expect(element.getBoundingClientRect().width).toBeGreaterThan(0);', "appearance"],
  ["dimension alias", 'const size = element.offsetWidth; const larger = size + 4; expect(larger).toBe(20);', "appearance"],
  ["style matcher", 'expect(element).toHaveStyle({ color: "red" });', "appearance"],
  ["text matcher", 'expect(element).toHaveTextContent("Save changes");', "copy-candidate"],
  ["text read", 'expect(element.textContent).toBe("Save changes");', "copy-candidate"],
  ["text query", 'expect(screen.getByText("Save changes")).toBeTruthy();', "copy-candidate"],
  ["role query as copy proof", 'expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();', "copy-candidate"],
  ["complete regex", 'expect(element.textContent).toMatch(/^Save changes$/);', "copy-candidate"],
  ["browser string", 'expect(await read("getComputedStyle(document.body).color")).toBe("red");', "appearance"],
  ["browser alias", 'const script = "document.body.getBoundingClientRect().width"; const result = await read(script); expect(result).toBe(10);', "appearance"],
  ["browser callback", 'const result = await page.evaluate(() => document.body.scrollWidth); expect(result).toBe(10);', "appearance"],
  ["browser object field", 'const result = await read("({ width: document.body.clientWidth })"); expect(result.width).toBe(10);', "appearance"],
  ["browser exact text", 'expect(await read("document.body.textContent")).toBe("Welcome");', "copy-candidate"],
  ["embedded comment is not a read", 'expect(await read("1 /* getComputedStyle(document.body) */")).toBe(1);', null],
  ["embedded string is not a read", 'expect(await read(`"getComputedStyle(document.body)"`)).toBe("getComputedStyle(document.body)");', null],
  ["style used for action only", 'const size = element.getBoundingClientRect(); await click(size.x, size.y); expect(calls).toHaveLength(1);', null],
  ["named ancestor is action scope", 'const scope = screen.getByRole("region", { name: "Actions" }); expect(within(scope).getAllByRole("button")).toHaveLength(2);', null],
  ["role presence without copy", 'expect(screen.getByRole("button")).toBeTruthy();', null],
  ["snapshot review", 'expect(element).toMatchInlineSnapshot(`Welcome`);', "snapshot-review"],
  ["unparsed browser review", 'expect(await read("return document.body.scrollWidth")).toBe(10);', "unparsed-browser-script"],
  ["role query locating action", 'const button = screen.getByRole("button", { name: "Save changes" }); button.click(); expect(calls).toHaveLength(1);', null],
  ["role query checking focus", 'expect(screen.getByRole("button", { name: "Save changes" })).toHaveFocus();', null],
  ["accessible name presence", 'expect(element).toHaveAccessibleName();', null],
  ["text presence", 'expect(element.textContent).not.toBe("");', null],
  ["call contract", 'expect(rpc).toHaveBeenCalledWith("Save changes");', null],
  ["round trip without literal", 'expect(element.textContent).toBe(userInput);', null],
  ["aliased expect", 'check(element.scrollWidth).toBe(10);', "appearance"],
  ["wrapped callee", '(expect(element.scrollWidth).toBe)(10);', "appearance"],
  ["shadowed expect", '{ const expect = x => ({ toBe: () => x }); expect(element.scrollWidth).toBe(10); }', null],
];

for (const [name, source, kind] of cases) {
  test(`t3779b_assertion_boundary: ${name}`, () => {
    const dir = mkdtempSync(resolve(repo, ".assertion-fixture-"));
    const file = resolve(dir, "fixture.test.tsx");
    const config = resolve(dir, "config.json");
    writeFileSync(file, 'import { expect, expect as check, test } from "vitest";\ntest("t3779b_fixture", async () => {\n' + source + '\n});');
    writeFileSync(resolve(dir, "package.json"), JSON.stringify({ scripts: { lint: `node ${lint}` } }));
    writeFileSync(config, JSON.stringify({
      jsPlugins: [{ name: "anti-slop", specifier: plugin }],
      rules: { "anti-slop/no-new-web-assertions": "error" },
    }));
    try {
      const result = spawnSync("pnpm", ["--dir", dir, "--silent", "lint", "--no-ignore", "--config", config, "--format", "json", file], { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, kind ? 1 : 0, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.number_of_files, 1, "The real lint command must analyze the fixture");
      const diagnostics = report.diagnostics.filter(item => item.code === "anti-slop(no-new-web-assertions)");
      assert.equal(diagnostics.length, kind ? 1 : 0, result.stdout);
      if (kind) {
        const observation = JSON.parse(diagnostics[0].message);
        assert.ok(observation.kinds.includes(kind), result.stdout);
        assert.equal(observation.test, "t3779b_fixture");
        assert.match(observation.identity, /^[a-f0-9]{64}$/);
      }
      if (process.env.ASSERTION_FIXTURE_REPORT) appendFileSync(process.env.ASSERTION_FIXTURE_REPORT, JSON.stringify({ name, source, exitCode: result.status, diagnostics: diagnostics.map(item => item.message) }) + "\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("t3779b_assertion_boundary: Python assertions and scripts are inventoried without execution", () => {
  const dir = mkdtempSync(resolve(repo, ".python-assertion-fixture-"));
  try {
    writeFileSync(resolve(dir, "fixture.test.py"), [
      'raise RuntimeError("This browser launcher must never execute")',
      'script = "document.body.getBoundingClientRect().width"',
      'def capture():',
      '    result = evaluate(script)',
      '    assert result > 0, result',
      '    assert evaluate("document.body.textContent") == "Welcome"',
    ].join("\n"));
    const result = spawnSync("python3", [resolve(repo, "tools/oxlint/anti-slop/web-assertions/python-audit.py"), dir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const rows = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(rows.map(row => row.assertion), ['assert result > 0, result', 'assert evaluate("document.body.textContent") == "Welcome"']);
    assert.ok(rows.every(row => row.test === "capture"));
    assert.ok(rows[0].dependencies.includes('script = "document.body.getBoundingClientRect().width"'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const change of ["unchanged", "additional", "duplicate", "deleted", "added entry", "broadened entry", "renamed", "moved", "edited"]) {
  test(`t3779b_assertion_boundary: baseline ${change}`, () => {
    const dir = mkdtempSync(resolve(repo, ".baseline-fixture-"));
    const file = resolve(dir, "fixture.test.tsx");
    const config = resolve(dir, "config.json");
    const baseline = resolve(dir, directory, "baseline.jsonl");
    mkdirSync(resolve(dir, directory), { recursive: true });
    const source = 'import { expect, test } from "vitest"; test("t3779b_fixture", () => { expect(element.scrollWidth).toBe(10); });';
    const run = () => spawnSync("pnpm", ["--dir", dir, "--silent", "lint", "--no-ignore", "--config", config, "--format", "json", file], { cwd: dir, encoding: "utf8" });
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    try {
      writeFileSync(resolve(dir, "package.json"), JSON.stringify({ scripts: { lint: `node ${lint}` } }));
      writeFileSync(file, source);
      writeFileSync(config, JSON.stringify({ jsPlugins: [{ name: "anti-slop", specifier: plugin }], rules: { "anti-slop/audit-web-assertions": "error" } }));
      const audit = run();
      assert.equal(audit.status, 1, audit.stdout + audit.stderr);
      const observation = JSON.parse(JSON.parse(audit.stdout).diagnostics[0].message);
      const entry = { file: "fixture.test.tsx", test: observation.test, identity: observation.identity };
      writeFileSync(baseline, JSON.stringify(entry) + "\n");
      git("init", "-q");
      git("add", ".");
      git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "baseline");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      writeFileSync(config, JSON.stringify({ jsPlugins: [{ name: "anti-slop", specifier: plugin }], rules: { "anti-slop/no-new-web-assertions": "error" } }));
      if (change === "additional") writeFileSync(file, source.replace(' });', ' expect(element.clientHeight).toBe(20); });'));
      if (change === "duplicate") writeFileSync(file, source.replace(' });', ' expect(element.scrollWidth).toBe(10); });'));
      if (change === "deleted") writeFileSync(file, source.replace('expect(element.scrollWidth).toBe(10);', ''));
      if (change === "added entry") appendFileSync(baseline, JSON.stringify({ ...entry, identity: "a".repeat(64) }) + "\n");
      if (change === "broadened entry") writeFileSync(baseline, JSON.stringify({ ...entry, test: "*" }) + "\n");
      if (change === "renamed") writeFileSync(file, source.replace("t3779b_fixture", "t3779b_other"));
      if (change === "moved") { writeFileSync(resolve(dir, "other.test.tsx"), source); writeFileSync(file, ""); }
      if (change === "edited") writeFileSync(file, source.replace("toBe(10)", "toBe(11)"));
      const result = run();
      assert.equal(result.status, change === "unchanged" ? 0 : 1, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.number_of_files, 1, result.stdout);
      assert.equal(report.diagnostics.length === 0, change === "unchanged", result.stdout);
      if (process.env.ASSERTION_FIXTURE_REPORT) appendFileSync(process.env.ASSERTION_FIXTURE_REPORT, JSON.stringify({ name: `baseline ${change}`, source, exitCode: result.status, diagnostics: report.diagnostics.map(item => item.message) }) + "\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

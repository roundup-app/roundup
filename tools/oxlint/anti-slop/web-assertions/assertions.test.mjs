import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = "tools/oxlint/anti-slop/web-assertions";
const lint = resolve(repo, directory, "lint.mjs");
const plugin = resolve(repo, "tools/oxlint/anti-slop/index.ts");
const cases = [
  ["computed style", 'expect(getComputedStyle(element).color).toBe("red");', "appearance"],
  ["geometry", 'expect(element.getBoundingClientRect().width).toBeGreaterThan(0);', "appearance"],
  ["mutable alias", 'let size; size = element.offsetWidth; expect(size).toBe(20);', "appearance"],
  ["dimension alias", 'const size = element.offsetWidth; const larger = size + 4; expect(larger).toBe(20);', "appearance"],
  ["style matcher", 'expect(element).toHaveStyle({ color: "red" });', "appearance"],
  ["text matcher", 'expect(element).toHaveTextContent("Save changes");', "copy-candidate"],
  ["copy alias", 'const label = "Save changes"; expect(element.textContent).toBe(label);', "copy-candidate"],
  ["query alias", 'const label = "Save changes"; expect(screen.getByText(label)).toBeTruthy();', "copy-candidate"],
  ["literal user round trip", 'const userInput = "Hello"; fireEvent.input(field, { target: { value: userInput } }); expect(element.textContent).toBe(userInput);', null],
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
  ["helper style used for action only", 'function act() { const size = element.getBoundingClientRect(); click(size.x, size.y); return calls.length; } expect(act()).toBe(1);', null],
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
    const dir = mkdtempSync(resolve(tmpdir(), ".assertion-fixture-"));
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


for (const change of ["unchanged", "removed with entry", "additional", "duplicate", "deleted", "added entry", "broadened entry", "rekeyed entry", "renamed", "moved", "edited", "timeout edited"]) {
  const passing = ["unchanged", "removed with entry", "timeout edited"];
  const name = change === "rekeyed entry"
    ? "t4448a_rekey_cannot_authorize_edited_assertion"
    : `t3779b_assertion_boundary: baseline ${change}`;
  test(name, () => {
    const dir = mkdtempSync(resolve(tmpdir(), ".baseline-fixture-"));
    const file = resolve(dir, "fixture.test.tsx");
    const config = resolve(dir, "config.json");
    const baseline = resolve(dir, directory, "baseline.jsonl");
    mkdirSync(resolve(dir, directory), { recursive: true });
    const source = 'import { expect, test } from "vitest"; test("t3779b_fixture", () => { expect(element.scrollWidth).toBe(10); }' + (change === "timeout edited" ? ", 90_000" : "") + ");";
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
      if (change === "removed with entry") { writeFileSync(file, source.replace('expect(element.scrollWidth).toBe(10);', '')); writeFileSync(baseline, ""); }
      if (change === "deleted") writeFileSync(file, source.replace('expect(element.scrollWidth).toBe(10);', ''));
      if (["added entry", "broadened entry", "rekeyed entry"].includes(change)) {
        writeFileSync(file, change === "added entry"
          ? source + '\ntest("t3779b_new", () => { expect(element.clientHeight).toBe(20); });'
          : source.replace("toBe(10)", "toBe(11)"));
        writeFileSync(config, JSON.stringify({ jsPlugins: [{ name: "anti-slop", specifier: plugin }], rules: { "anti-slop/audit-web-assertions": "error" } }));
        const current = run();
        assert.equal(current.status, 1, current.stdout + current.stderr);
        const rows = JSON.parse(current.stdout).diagnostics.filter(item => item.code === "anti-slop(audit-web-assertions)").map(item => JSON.parse(item.message));
        // These entries match the new source exactly: only the subset check can reject them.
        writeFileSync(baseline, rows.map(row => JSON.stringify({ file: "fixture.test.tsx", test: row.test, identity: row.identity })).join("\n") + "\n");
        if (change === "rekeyed entry") writeFileSync(resolve(dir, directory, "rekey.jsonl"), JSON.stringify({
          file: entry.file, test: entry.test, from: entry.identity, to: rows[0].identity,
        }) + "\n");
        writeFileSync(config, JSON.stringify({ jsPlugins: [{ name: "anti-slop", specifier: plugin }], rules: { "anti-slop/no-new-web-assertions": "error" } }));
      }
      if (change === "renamed") writeFileSync(file, source.replace("t3779b_fixture", "t3779b_other"));
      if (change === "moved") { writeFileSync(resolve(dir, "other.test.tsx"), source); writeFileSync(file, ""); }
      if (change === "timeout edited") writeFileSync(file, source.replace("90_000", "60_000"));
      if (change === "edited") writeFileSync(file, source.replace("toBe(10)", "toBe(11)"));
      const result = run();
      assert.equal(result.status, passing.includes(change) ? 0 : 1, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.number_of_files, 1, result.stdout);
      if (["added entry", "broadened entry", "rekeyed entry"].includes(change)) assert.ok(report.diagnostics.some(item => item.message.startsWith("Added or broadened assertion baseline entry:")), result.stdout);
      assert.equal(report.diagnostics.filter(item => item.severity === "error").length === 0, passing.includes(change), result.stdout);
      if (process.env.ASSERTION_FIXTURE_REPORT) appendFileSync(process.env.ASSERTION_FIXTURE_REPORT, JSON.stringify({ name: `baseline ${change}`, source: readFileSync(file, "utf8"), exitCode: result.status, diagnostics: report.diagnostics.map(item => item.message) }) + "\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [name, source, forbidden] of [
  ["computed style", 'assert evaluate("getComputedStyle(document.body).color") == "red"', true],
  ["geometry alias", 'script = "document.body.getBoundingClientRect().width"\nresult = evaluate(script)\nassert result > 0', true],
  ["exact DOM copy", 'assert evaluate("document.body.textContent") == "Welcome"', true],
  ["copy alias", 'label = "Welcome"\nassert evaluate("document.body.textContent") == label', true],
  ["complete regex", 'assert re.fullmatch("Welcome", evaluate("document.body.textContent"))', true],
  ["behavior count", 'calls = 2\nassert calls == 2', false],
  ["user content round trip", 'user_input = "Welcome"\nfill(user_input)\nassert evaluate("document.body.textContent") == user_input', false],
  ["action setup", 'evaluate("document.body.getBoundingClientRect().width")\nassert calls == 2', false],
]) {
  test(`t3779b_assertion_boundary: Python ${name}`, () => {
    const dir = mkdtempSync(resolve(tmpdir(), ".python-lint-fixture-"));
    const config = resolve(dir, "config.json");
    const file = resolve(dir, "fixture.test.tsx");
    try {
      writeFileSync(file, "");
      writeFileSync(resolve(dir, "fixture.test.py"), 'raise RuntimeError("Launcher must never execute")\n' + source + "\n");
      writeFileSync(resolve(dir, "package.json"), JSON.stringify({ scripts: { lint: `node ${lint}` } }));
      writeFileSync(config, JSON.stringify({ jsPlugins: [{ name: "anti-slop", specifier: plugin }], rules: { "anti-slop/no-new-web-assertions": "error" } }));
      const result = spawnSync("pnpm", ["--dir", dir, "--silent", "lint", "--no-ignore", "--config", config, "--format", "json", file], { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, forbidden ? 1 : 0, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.number_of_files, 1);
      const errors = report.diagnostics.filter(item => item.severity === "error");
      assert.equal(errors.length, forbidden ? 1 : 0, result.stdout);
      if (forbidden) assert.match(errors[0].message, /New Python appearance\/copy assertion/);
      if (process.env.ASSERTION_FIXTURE_REPORT) appendFileSync(process.env.ASSERTION_FIXTURE_REPORT, JSON.stringify({ name: `Python ${name}`, source, exitCode: result.status, diagnostics: report.diagnostics.map(item => item.message) }) + "\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [name, source, forbidden] of [
  ["appearance", 'expect(getComputedStyle(element).color).toBe("red");', true],
  ["behavior", 'expect(screen.getByRole("button")).toBeTruthy();', false],
]) {
  test(`t3779b_assertion_boundary: repository config ${name}`, () => {
    const dir = mkdtempSync(resolve(tmpdir(), "roundup-normal-assertion-"));
    const file = resolve(dir, "fixture.test.tsx");
    try {
      writeFileSync(file, 'import { expect, test } from "vitest";\n\ntest("t3779b_fixture", () => {\n  ' + source + '\n});\n');
      const result = spawnSync("pnpm", ["--silent", "lint", "--no-ignore", "--config", resolve(repo, ".oxlintrc.json"), "--format", "json", file], { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, forbidden ? 1 : 0, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.number_of_files, 1);
      const diagnostics = report.diagnostics.filter(item => item.code === "anti-slop(no-new-web-assertions)");
      assert.equal(diagnostics.length, forbidden ? 1 : 0, result.stdout);
      if (process.env.ASSERTION_FIXTURE_REPORT) appendFileSync(process.env.ASSERTION_FIXTURE_REPORT, JSON.stringify({ name: `repository config ${name}`, source, exitCode: result.status, diagnostics: diagnostics.map(item => item.message) }) + "\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const change of ["unchanged", "stale", "navigation", "merged navigation", "function navigation", "edited", "dependency", "helper", "duplicate", "additional", "renamed", "moved", "reordered", "control"]) {
  test(`t3779b_assertion_boundary: Python baseline ${change}`, () => {
    const dir = mkdtempSync(resolve(tmpdir(), "roundup-python-baseline-"));
    const config = resolve(dir, "config.json");
    const file = resolve(dir, "fixture.test.tsx");
    const pythonFile = resolve(dir, "fixture.test.py");
    const baseline = resolve(dir, directory, "baseline.jsonl");
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    try {
      mkdirSync(resolve(dir, directory), { recursive: true });
      writeFileSync(file, "export {};\n");
      const body = 'raise RuntimeError("Launcher must never execute")\ndef observe():\n    return 0\nscript = "document.body.clientWidth"\nresult = evaluate(script)\nbrowser("open", "/old")\nassert result > 0\nbrowser("click", "button")\n'.replace("assert result > 0", change === "helper" ? "assert result > observe()" : "assert result > 0");
      const source = ["function navigation", "renamed"].includes(change)
        ? "def test_fixture():\n" + body.split("\n").filter(Boolean).map(line => "    " + line).join("\n") + "\n"
        : body;
      writeFileSync(pythonFile, source);
      const audit = spawnSync("python3", [resolve(repo, directory, "python-audit.py"), dir], { encoding: "utf8" });
      assert.equal(audit.status, 0, audit.stderr);
      const row = JSON.parse(audit.stdout);
      writeFileSync(baseline, JSON.stringify({ file: row.file, test: row.test, identity: row.identity }) + "\n");
      writeFileSync(resolve(dir, "package.json"), JSON.stringify({ scripts: { lint: `node ${lint}` } }));
      writeFileSync(config, JSON.stringify({ jsPlugins: [{ name: "anti-slop", specifier: plugin }], rules: { "anti-slop/no-new-web-assertions": "error" } }));
      git("init", "-q");
      git("add", ".");
      git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "baseline");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      if (change === "stale") writeFileSync(pythonFile, 'raise RuntimeError("Launcher must never execute")\n');
      if (["navigation", "merged navigation", "function navigation"].includes(change)) writeFileSync(pythonFile, source.replace('browser("open", "/old")', 'browser("press", "Meta+k")\n' + (change === "function navigation" ? "    " : "") + 'browser("open", "/new")'));
      if (change === "merged navigation") {
        git("add", ".");
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "navigation");
        git("update-ref", "refs/remotes/origin/main", "HEAD");
      }
      if (change === "edited") writeFileSync(pythonFile, source.replace("result > 0", "result > 1"));
      if (change === "dependency") writeFileSync(pythonFile, source.replace('script = "document.body.clientWidth"', 'script = "document.body.clientHeight"'));
      if (change === "helper") writeFileSync(pythonFile, source.replace("return 0", "return 1"));
      if (change === "duplicate") writeFileSync(pythonFile, source + "assert result > 0\n");
      if (change === "additional") writeFileSync(pythonFile, source + 'assert evaluate("document.body.clientHeight") > 0\n');
      if (change === "renamed") writeFileSync(pythonFile, source.replace("test_fixture", "test_other"));
      if (change === "moved") { writeFileSync(pythonFile, ""); writeFileSync(resolve(dir, "other.test.py"), source); }
      if (change === "reordered") writeFileSync(pythonFile, source.replace('assert result > 0\nbrowser("click", "button")', 'browser("click", "button")\nassert result > 0'));
      if (change === "control") writeFileSync(pythonFile, source.replace("assert result > 0", "if ready:\n    assert result > 0"));
      const result = spawnSync("pnpm", ["--dir", dir, "--silent", "lint", "--no-ignore", "--config", config, "--format", "json", file], { cwd: dir, encoding: "utf8" });
      const passing = ["unchanged", "navigation", "merged navigation", "function navigation"].includes(change);
      assert.equal(result.status, passing ? 0 : 1, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      const errors = report.diagnostics.filter(item => item.severity === "error");
      assert.equal(errors.length === 0, passing, result.stdout);
      if (change === "stale") assert.match(errors[0].message, /Stale Python assertion baseline entry/);
      if (process.env.ASSERTION_FIXTURE_REPORT) appendFileSync(process.env.ASSERTION_FIXTURE_REPORT, JSON.stringify({ name: `Python baseline ${change}`, source: 'assert evaluate("document.body.clientWidth") > 0', exitCode: result.status, diagnostics: errors.map(item => item.message) }) + "\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

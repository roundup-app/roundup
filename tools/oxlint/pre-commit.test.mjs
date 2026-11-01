import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));

const unfixed = "export function answer() {\n  const value = 42;\n  return value;\n}\n";

const fixed = "export function answer() {\n  const value = 42;\n\n  return value;\n}\n";

const baseline = "pre-commit:\n  commands:\n    file-stays-under-a-size-cap:\n      run: .claude/sound/placement/file-stays-under-a-size-cap.gate\n";

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("LEFTHOOK")));

env.PATH = resolve(repo, "node_modules/.bin") + ":" + env.PATH;

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 30_000 });

  if (result.error) throw result.error;

  return result;
}

function git(cwd, ...args) {
  const result = run(cwd, "git", args);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  return result.stdout;
}

function write(cwd, path, content) {
  mkdirSync(dirname(resolve(cwd, path)), { recursive: true });
  writeFileSync(resolve(cwd, path), content);
}

function fixture(t, config = readFileSync(resolve(repo, "lefthook.yml"), "utf8")) {
  const cwd = mkdtempSync(resolve(tmpdir(), "roundup-pre-commit-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  for (const path of [".gitignore", ".oxlintrc.json", ".claude/sound/placement/file-stays-under-a-size-cap.gate", "tools/oxlint/anti-slop"]) {
    const target = resolve(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(resolve(repo, path), target, { recursive: true });
  }

  // This isolated repository has no legacy assertions to grandfather.
  rmSync(resolve(cwd, "tools/oxlint/anti-slop/web-assertions/baseline.jsonl"));
  symlinkSync(resolve(repo, "node_modules"), resolve(cwd, "node_modules"), "dir");
  write(cwd, "lefthook.yml", config);
  git(cwd, "init", "--quiet");
  git(cwd, "config", "core.hooksPath", resolve(cwd, ".git/hooks"));
  git(cwd, "config", "user.email", "hook-test@example.invalid");
  git(cwd, "config", "user.name", "Hook observer");
  git(cwd, "config", "commit.gpgsign", "false");
  write(cwd, "unrelated.ts", fixed);
  git(cwd, "add", "unrelated.ts");
  git(cwd, "commit", "--quiet", "-m", "Seed unrelated file");
  const installed = run(cwd, "lefthook", ["install", "--force"]);
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);

  return cwd;
}

function lint(cwd, path) {
  return run(cwd, process.execPath, [resolve(repo, "tools/oxlint/anti-slop/web-assertions/lint.mjs"), path]);
}

test("t5456a_commit_contains_the_spacing_fix", t => {
  const cwd = fixture(t);
  write(cwd, "source with spaces.ts", unfixed);
  git(cwd, "add", "source with spaces.ts");
  git(cwd, "commit", "--quiet", "-m", "Commit spacing fixture");
  assert.equal(git(cwd, "show", "HEAD:source with spaces.ts"), fixed);
  const checked = lint(cwd, "source with spaces.ts");
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

test("t5456a_unstaged_file_stays_out_of_the_commit", t => {
  const cwd = fixture(t);
  write(cwd, "unrelated.ts", unfixed);
  write(cwd, "selected.ts", unfixed);
  git(cwd, "add", "selected.ts");
  git(cwd, "commit", "--quiet", "-m", "Commit selected file");
  assert.equal(readFileSync(resolve(cwd, "unrelated.ts"), "utf8"), unfixed);
  assert.equal(git(cwd, "show", "HEAD:unrelated.ts"), fixed);
  assert.equal(git(cwd, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim(), "selected.ts");
});

test("t5456a_supported_web_extensions_are_fixed", t => {
  const cwd = fixture(t);
  const paths = ["nested/source.js", "source.jsx", "source.tsx", "source.mjs", "source.mts", "source.cjs", "source.cts"];
  const contents = (path, source) => path.endsWith(".cjs") || path.endsWith(".cts") ? source.replace("export function answer()", "module.exports = function answer()") : source;

  for (const path of paths) write(cwd, path, contents(path, unfixed));
  git(cwd, "add", ...paths);
  git(cwd, "commit", "--quiet", "-m", "Commit web variants");

  for (const path of paths) assert.equal(git(cwd, "show", "HEAD:" + path), contents(path, fixed), path);
});

test("t5456a_ignored_paths_keep_their_bytes", t => {
  const cwd = fixture(t);
  const paths = ["contracts/generated/source.ts", ".agents/source.ts", "spikes/source.ts"];

  for (const path of paths) write(cwd, path, unfixed);
  git(cwd, "add", ...paths);
  git(cwd, "commit", "--quiet", "-m", "Commit ignored paths");

  for (const path of paths) assert.equal(git(cwd, "show", "HEAD:" + path), unfixed, path);
});

test("t5456a_no_web_files_skips_lint", t => {
  const cwd = fixture(t);
  // A full-tree fallback would encounter this unselected syntax error.
  write(cwd, "unselected.ts", "export function {\n");
  write(cwd, "notes.md", "A note\n");
  git(cwd, "add", "notes.md");
  git(cwd, "commit", "--quiet", "-m", "Commit documentation");
  assert.equal(git(cwd, "show", "HEAD:notes.md"), "A note\n");
});

test("t5456b_ci_rejects_unfixed_spacing_without_writing", t => {
  const cwd = fixture(t);
  write(cwd, "source.ts", unfixed);
  const rejected = lint(cwd, "source.ts");
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(rejected.stdout + rejected.stderr, /anti-slop\(require-readable-spacing\)/);
  assert.equal(readFileSync(resolve(cwd, "source.ts"), "utf8"), unfixed);
  write(cwd, "source.ts", fixed);
  const accepted = lint(cwd, "source.ts");
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
});

test("t5456c_small_commit_hook_stays_under_five_seconds", t => {
  function measure(config) {
    const cwd = fixture(t, config);

    for (const path of ["one.ts", "two.ts", "three.ts"]) write(cwd, path, path === "one.ts" ? unfixed : fixed);
    git(cwd, "add", "one.ts", "two.ts", "three.ts");
    const start = performance.now();
    git(cwd, "commit", "--quiet", "-m", "Measure three-file commit");

    return performance.now() - start;
  }

  const before = measure(baseline);
  const after = measure(readFileSync(resolve(repo, "lefthook.yml"), "utf8"));
  t.diagnostic(`baseline ${before.toFixed(1)} ms; candidate ${after.toFixed(1)} ms; added ${(after - before).toFixed(1)} ms (first lint startup included)`);
  assert.ok(after - before < 5000);
});

test("t5456a_size_guard_checks_the_fixed_contents", t => {
  const cwd = fixture(t);
  const source = "// padding\n".repeat(996) + unfixed;
  write(cwd, "at-cap.ts", source);
  git(cwd, "add", "at-cap.ts");
  const committed = run(cwd, "git", ["commit", "--quiet", "-m", "Fix would grow beyond cap"]);
  assert.equal(committed.status, 1, committed.stdout + committed.stderr);
  assert.match(committed.stdout + committed.stderr, /at-cap.ts\s+1001 lines/);
  assert.equal(git(cwd, "log", "-1", "--format=%s").trim(), "Seed unrelated file");
});

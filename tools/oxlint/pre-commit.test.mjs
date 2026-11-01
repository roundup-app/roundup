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

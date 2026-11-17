import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("LEFTHOOK")));

env.PATH = resolve(repo, "node_modules/.bin") + ":" + env.PATH;

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 60_000 });

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

const clean = "export const first: number = 1;\n\nexport const second: number = 2;\n";

const lintError = "export const bad = Reflect.apply(Math.max, undefined, [1]);\n";

// A clone with the real hook configuration and a bare remote that already holds `main`.
function fixture(t) {
  const base = mkdtempSync(resolve(tmpdir(), "roundup-pre-push-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const cwd = resolve(base, "clone");
  const remote = resolve(base, "remote.git");
  mkdirSync(cwd);

  for (const path of ["package.json", ".gitignore", ".oxlintrc.json", "tsconfig.json", "lefthook.yml", "tools/oxlint/anti-slop", "tools/oxlint/added-lines.mjs", "tools/oxlint/pre-push.mjs"]) {
    const target = resolve(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(resolve(repo, path), target, { recursive: true });
  }

  rmSync(resolve(cwd, "tools/oxlint/anti-slop/web-assertions/baseline.jsonl"));
  symlinkSync(resolve(repo, "node_modules"), resolve(cwd, "node_modules"), "dir");
  write(cwd, "tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: "ESNext", moduleResolution: "Bundler", target: "ES2023" }, include: ["src"] }));
  write(cwd, "src/clean.ts", clean);
  write(cwd, "src/old.ts", lintError + "\nexport const tail = 1;\n");
  git(cwd, "init", "--quiet", "-b", "main");
  git(cwd, "config", "core.hooksPath", resolve(cwd, ".git/hooks"));
  git(cwd, "config", "user.email", "hook-test@example.invalid");
  git(cwd, "config", "user.name", "Hook observer");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "add", ".");
  git(cwd, "commit", "--quiet", "--no-verify", "-m", "Seed");
  git(base, "init", "--quiet", "--bare", "-b", "main", remote);
  git(cwd, "remote", "add", "origin", remote);
  git(cwd, "push", "--quiet", "--no-verify", "origin", "main");
  const installed = run(cwd, "lefthook", ["install", "--force"]);
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  git(cwd, "checkout", "--quiet", "-b", "feature");

  return { cwd, remote };
}

function push(cwd) {
  return run(cwd, "git", ["push", "origin", "feature"]);
}

function remoteHasFeature(remote) {
  return run(remote, "git", ["rev-parse", "--verify", "--quiet", "refs/heads/feature"]).status === 0;
}

function commit(cwd, path, content) {
  write(cwd, path, content);
  git(cwd, "add", path);
  git(cwd, "commit", "--quiet", "--no-verify", "-m", "Change " + path);
}

test("t7331a_push_fails_on_a_lint_error_on_an_added_line", t => {
  const { cwd, remote } = fixture(t);
  commit(cwd, "src/clean.ts", clean + lintError.replace("bad", "worse"));
  const pushed = push(cwd);
  assert.equal(pushed.status, 1, pushed.stdout + pushed.stderr);
  assert.match(pushed.stdout + pushed.stderr, /src\/clean\.ts:4:\d+: error anti-slop\(no-reflect-apply\)/);
  assert.equal(remoteHasFeature(remote), false);
});

test("t7331b_push_fails_on_a_type_error", t => {
  const { cwd, remote } = fixture(t);
  commit(cwd, "src/clean.ts", clean + "\nexport const wrong: number = \"text\";\n");
  const pushed = push(cwd);
  assert.equal(pushed.status, 1, pushed.stdout + pushed.stderr);
  assert.match(pushed.stdout + pushed.stderr, /src\/clean\.ts\(5,\d+\): error TS2322/);
  assert.equal(remoteHasFeature(remote), false);
});

test("t7331b_push_of_clean_files_passes", t => {
  const { cwd, remote } = fixture(t);
  commit(cwd, "src/clean.ts", clean + "\nexport const third: number = 3;\n");
  const pushed = push(cwd);
  assert.equal(pushed.status, 0, pushed.stdout + pushed.stderr);
  assert.equal(remoteHasFeature(remote), true);
});

test("t7331c_push_ignores_a_lint_error_on_a_line_it_does_not_add", t => {
  const { cwd, remote } = fixture(t);
  commit(cwd, "src/old.ts", lintError + "\nexport const tail = 2;\n");
  const pushed = push(cwd);
  assert.equal(pushed.status, 0, pushed.stdout + pushed.stderr);
  assert.equal(remoteHasFeature(remote), true);
});

test("t7331d_push_hook_leaves_the_tree_as_it_was", t => {
  const { cwd } = fixture(t);
  // The spacing fix is safe to apply, so a hook that ran --fix would rewrite this file.
  const unfixed = "export function answer() {\n  const value = 42;\n  return value;\n}\n";
  commit(cwd, "src/unfixed.ts", unfixed);
  write(cwd, "src/staged.ts", unfixed);
  git(cwd, "add", "src/staged.ts");
  const status = git(cwd, "status", "--porcelain");
  const index = git(cwd, "diff", "--cached");
  push(cwd);
  assert.equal(readFileSync(resolve(cwd, "src/unfixed.ts"), "utf8"), unfixed);
  assert.equal(readFileSync(resolve(cwd, "src/staged.ts"), "utf8"), unfixed);
  assert.equal(git(cwd, "diff", "--cached"), index);
  assert.equal(git(cwd, "status", "--porcelain"), status);
});

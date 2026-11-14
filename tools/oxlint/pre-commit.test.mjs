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

function run(cwd, command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...env, ...extra }, encoding: "utf8", timeout: 30_000 });

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

  for (const path of ["package.json", ".gitignore", ".oxlintrc.json", ".claude/sound/placement/file-stays-under-a-size-cap.gate", "tools/oxlint/anti-slop", "tools/oxlint/staged.mjs"]) {
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
  write(cwd, "source.ts", unfixed);
  git(cwd, "add", "source.ts");
  git(cwd, "commit", "--quiet", "-m", "Commit only selected file");
  assert.equal(readFileSync(resolve(cwd, "unrelated.ts"), "utf8"), unfixed);
  assert.equal(git(cwd, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"), "source.ts\n");
  assert.equal(git(cwd, "show", "HEAD:unrelated.ts"), fixed);
});

test("t5456b_ci_rejects_unfixed_spacing_without_writing", t => {
  const cwd = fixture(t);
  write(cwd, "source.ts", unfixed);
  const rejected = lint(cwd, "source.ts");
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(rejected.stdout + rejected.stderr, /anti-slop[(/]require-readable-spacing/);
  assert.equal(readFileSync(resolve(cwd, "source.ts"), "utf8"), unfixed);
  write(cwd, "source.ts", fixed);
  const accepted = lint(cwd, "source.ts");
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
});

test("t5456c_small_commit_hook_stays_under_five_seconds", t => {
  const original = fixture(t, baseline);
  const candidate = fixture(t);
  const elapsed = [];

  for (const cwd of [original, candidate]) {
    for (const [path, content] of [["first.ts", unfixed], ["second.ts", fixed], ["third.ts", fixed]]) {
      write(cwd, path, content);
      git(cwd, "add", path);
    }

    const start = performance.now();
    git(cwd, "commit", "--quiet", "-m", "Measure three-file commit");
    elapsed.push(performance.now() - start);
  }

  const added = elapsed[1] - elapsed[0];
  t.diagnostic(`size guard: ${elapsed[0].toFixed(1)} ms; lint hook: ${elapsed[1].toFixed(1)} ms; added: ${added.toFixed(1)} ms (including first lint startup)`);
  assert.ok(added < 5000, `hook added ${added.toFixed(1)} ms`);
});

test("t5456d_hook_fails_only_on_errors_in_added_lines", t => {
  const cwd = fixture(t);
  const old = "export const first = Reflect.apply(Math.max, undefined, [1]);\n\nexport const second = 2;\n";
  const edited = old.replace("= 2", "= 3");
  write(cwd, "source.ts", old);
  git(cwd, "add", "source.ts");
  git(cwd, "commit", "--quiet", "--no-verify", "-m", "Seed an error the hook never saw");
  write(cwd, "source.ts", edited);
  git(cwd, "add", "source.ts");
  const kept = run(cwd, "git", ["commit", "-m", "Edit a line beside the old error"]);
  assert.equal(kept.status, 0, kept.stdout + kept.stderr);
  write(cwd, "source.ts", edited + "\nexport const third = Reflect.apply(Math.min, undefined, [1]);\n");
  git(cwd, "add", "source.ts");
  const rejected = run(cwd, "git", ["commit", "-m", "Add a new error"]);
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(rejected.stdout + rejected.stderr, /source\.ts:5:\d+: error anti-slop\(no-reflect-apply\)/);
});

test("t5456a_nested_web_extensions_receive_safe_fixes", t => {
  const cwd = fixture(t);
  const paths = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"].map(extension => `src/nested/source.${extension}`);

  for (const path of paths) write(cwd, path, unfixed.replace("export ", ""));
  git(cwd, "add", ...paths);
  git(cwd, "commit", "--quiet", "-m", "Commit web extensions");

  for (const path of paths) assert.equal(git(cwd, "show", `HEAD:${path}`), fixed.replace("export ", ""), path);
});

test("t5456a_no_matching_files_skips_lint", t => {
  const cwd = fixture(t);
  write(cwd, "unrelated.ts", unfixed);
  write(cwd, "note.md", "A non-web change.\n");
  git(cwd, "add", "note.md");
  const committed = run(cwd, "git", ["commit", "-m", "Commit only prose"]);
  assert.equal(committed.status, 0, committed.stdout + committed.stderr);
  assert.match(committed.stdout + committed.stderr, /lint-web.*skip|skip.*lint-web/);
  assert.equal(readFileSync(resolve(cwd, "unrelated.ts"), "utf8"), unfixed);
});

test("t5456a_ignored_generated_paths_keep_their_bytes", t => {
  const cwd = fixture(t);
  const paths = ["contracts/generated/source.ts", "spikes/source.ts", ".agents/source.ts"];

  for (const path of paths) write(cwd, path, unfixed);
  git(cwd, "add", ...paths);
  git(cwd, "commit", "--quiet", "-m", "Commit ignored fixtures");

  for (const path of paths) assert.equal(git(cwd, "show", `HEAD:${path}`), unfixed, path);
});

test("t5456a_safe_fix_cannot_evade_the_size_guard", t => {
  const cwd = fixture(t);
  write(cwd, "source.ts", unfixed + "\n".repeat(996));
  git(cwd, "add", "source.ts");
  const committed = run(cwd, "git", ["commit", "-m", "Commit a file at the cap"]);
  assert.equal(committed.status, 1, committed.stdout + committed.stderr);
  assert.match(committed.stdout + committed.stderr, /source.ts\s+1001 lines/);
});

test("t5496a_partial_staging_preserves_unstaged_hunks", t => {
  const cwd = fixture(t);
  const path = "source with spaces.ts";
  const unchanged = "\n// The second function is a separate hunk.\n// Keep this boundary unchanged.\n// Only the first function is selected.\n\n";
  const originalTail = "export function other() {\n  return 10;\n}\n";
  const editedTail = "export function other() {\n  return 20;\n}\n";
  write(cwd, path, fixed + unchanged + originalTail);
  git(cwd, "add", path);
  git(cwd, "commit", "--quiet", "-m", "Seed both functions");

  write(cwd, path, unfixed.replace("42", "43") + unchanged + originalTail);
  git(cwd, "add", path);
  write(cwd, path, unfixed.replace("42", "43") + unchanged + editedTail);

  git(cwd, "commit", "--quiet", "-m", "Commit only selected hunk");

  const committed = "export function answer() {\n  const value = 43;\n\n  return value;\n}\n" + unchanged + originalTail;
  assert.equal(git(cwd, "show", `HEAD:${path}`), committed);
  assert.equal(git(cwd, "show", `:${path}`), committed);
  assert.equal(readFileSync(resolve(cwd, path), "utf8"), committed.replace(originalTail, editedTail));
  assert.equal(git(cwd, "diff", "--cached"), "");
  assert.equal(git(cwd, "diff", "--no-ext-diff", "--no-color", "--unified=0", "--", path).replace(/^index .*\n/m, ""), "diff --git a/source with spaces.ts b/source with spaces.ts\n" +
    "--- a/source with spaces.ts\t\n+++ b/source with spaces.ts\t\n@@ -12 +12 @@ export function other() {\n-  return 10;\n+  return 20;\n");
});

test("t6011a_fix_applies_the_safe_fixes_and_a_second_run_changes_nothing", t => {
  const cwd = fixture(t);

  for (const path of ["justfile", "loop/keep-going.sh"]) cpSync(resolve(repo, path), resolve(cwd, path));
  write(cwd, "Cargo.toml", '[package]\nname = "fixture"\nversion = "0.0.0"\nedition = "2024"\n');
  write(cwd, "src/lib.rs", "pub fn answer()->u32{42}\n");
  write(cwd, "source.ts", unfixed);
  const first = run(cwd, "just", ["fix"]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(readFileSync(resolve(cwd, "source.ts"), "utf8"), fixed);
  const checked = lint(cwd, "source.ts");
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const formatted = run(cwd, "cargo", ["fmt", "--check"]);
  assert.equal(formatted.status, 0, formatted.stdout + formatted.stderr);
  const rust = readFileSync(resolve(cwd, "src/lib.rs"), "utf8");
  const second = run(cwd, "just", ["fix"]);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(readFileSync(resolve(cwd, "source.ts"), "utf8"), fixed);
  assert.equal(readFileSync(resolve(cwd, "src/lib.rs"), "utf8"), rust);
});

function builder(t, cwd) {
  const temp = mkdtempSync(resolve(tmpdir(), "roundup-runner-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const stamped = run(cwd, "bash", [resolve(repo, "loop/author.sh"), "builder-7"], { RUNNER_TEMP: temp });
  assert.equal(stamped.status, 0, stamped.stdout + stamped.stderr);
}

test("t6011b_builder_commit_contains_the_spacing_fix", t => {
  const cwd = fixture(t);
  builder(t, cwd);
  write(cwd, "source.ts", unfixed);
  git(cwd, "add", "source.ts");
  git(cwd, "commit", "--quiet", "-m", "Builder commit");
  assert.equal(git(cwd, "show", "HEAD:source.ts"), fixed);
  assert.equal(git(cwd, "log", "-1", "--format=%(trailers:key=Author-Agent,valueonly)"), "builder-7\n\n");
});

test("t6011b_builder_merge_commits_main_as_it_is", t => {
  const cwd = fixture(t);
  git(cwd, "switch", "--quiet", "-c", "build/fixture");
  git(cwd, "switch", "--quiet", "-");
  // main holds a file over the size cap, as one merged past `pre` would.
  write(cwd, "main.ts", fixed + "\n".repeat(996));
  git(cwd, "add", "main.ts");
  git(cwd, "commit", "--quiet", "--no-verify", "-m", "Main grows a file past the cap");
  git(cwd, "switch", "--quiet", "build/fixture");
  builder(t, cwd);
  // A merge git makes runs no pre-commit hook; one a run finishes by `git commit`, as after a conflict, does.
  git(cwd, "merge", "--quiet", "--no-ff", "--no-commit", "-");
  const merged = run(cwd, "git", ["commit", "--no-edit"]);
  assert.equal(merged.status, 0, merged.stdout + merged.stderr);
  assert.equal(git(cwd, "rev-list", "--count", "--merges", "HEAD"), "1\n");
});

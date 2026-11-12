import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pythonAssertionKinds } from "./browser.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
const repo = resolve(directory, "../../../..");

/** Audit rows ({file, test, identity, kinds, assertion}) of `files` as `revision` holds them; a null revision reads the working tree. */
export function observations(root, revision, files) {
  const scratch = mkdtempSync(resolve(tmpdir(), "assertion-swap-"));
  const rows = [];
  try {
    const present = [];
    for (const file of files) {
      let text;
      try {
        text = revision ? execFileSync("git", ["show", revision + ":" + file], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) : readFileSync(resolve(root, file), "utf8");
      } catch {
        continue;
      }
      mkdirSync(dirname(resolve(scratch, file)), { recursive: true });
      writeFileSync(resolve(scratch, file), text);
      present.push(file);
    }
    const typescript = present.filter(file => !file.endsWith(".py"));
    if (typescript.length) {
      const lint = spawnSync(resolve(repo, "node_modules/.bin/oxlint"), ["--config", resolve(directory, "audit.json"), "--no-ignore", "--format", "json", ...typescript], { cwd: scratch, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (![0, 1].includes(lint.status)) throw new Error("Cannot audit assertion identities: " + lint.stdout + lint.stderr);
      for (const item of JSON.parse(lint.stdout).diagnostics.filter(item => item.code === "anti-slop(audit-web-assertions)")) {
        const { test, identity, kinds, assertion } = JSON.parse(item.message);
        rows.push({ file: relative(realpathSync(scratch), realpathSync(resolve(scratch, item.filename))).replaceAll("\\", "/"), test, identity, kinds, assertion });
      }
    }
    if (present.some(file => file.endsWith(".py"))) {
      const python = spawnSync("python3", [resolve(directory, "python-audit.py"), scratch], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (python.status !== 0) throw new Error(python.stderr);
      for (const line of python.stdout.split("\n").filter(Boolean)) {
        const row = JSON.parse(line);
        const kinds = pythonAssertionKinds(row);
        if (kinds.length) rows.push({ file: row.file, test: row.test, identity: row.identity, kinds, assertion: row.assertion });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return rows;
}

/** The rows that `entries` name at `revision`. */
export function rowsOf(root, revision, entries) {
  const rows = observations(root, revision, [...new Set(entries.map(entry => entry.file))]);
  const named = list => list.flatMap(entry => rows.filter(row => row.file === entry.file && row.identity === entry.identity));
  const found = named(entries);
  const missing = revision ? entries.filter(entry => entry.file.endsWith(".py") && !found.some(row => row.file === entry.file && row.identity === entry.identity)) : [];
  return missing.length ? [...found, ...earlierRows(root, revision, missing)] : found;
}

// A Python identity once followed its row through Git history; the revision's own tool still reproduces those identities.
function earlierRows(root, revision, entries) {
  const scratch = mkdtempSync(resolve(tmpdir(), "assertion-swap-tree-"));
  const tree = resolve(scratch, "tree");
  try {
    if (spawnSync("git", ["worktree", "add", "--detach", tree, revision], { cwd: root }).status !== 0) return [];
    try {
      const python = spawnSync("python3", [resolve(tree, "tools/oxlint/anti-slop/web-assertions/python-audit.py"), tree], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (python.status !== 0) return [];
      return python.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line)).flatMap(row => {
        const kinds = pythonAssertionKinds(row);
        return kinds.length && entries.some(entry => entry.file === row.file && entry.identity === row.identity) ? [{ file: row.file, test: row.test, identity: row.identity, kinds, assertion: row.assertion }] : [];
      });
    } finally {
      spawnSync("git", ["worktree", "remove", "--force", tree], { cwd: root });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const shape = row => JSON.stringify([row.file, row.test, row.assertion, [...row.kinds].sort()]);

/** One-to-one identity swaps: an old row and a new row with the same file, test, assertion text and violation kinds. */
export function pairSwaps(olds, news) {
  const open = [...news];
  const pairs = [];
  for (const old of olds) {
    const index = open.findIndex(row => shape(row) === shape(old));
    if (index >= 0) pairs.push([old, open.splice(index, 1)[0]]);
  }
  return pairs;
}

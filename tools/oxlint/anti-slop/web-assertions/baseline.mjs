import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const baselinePath = "tools/oxlint/anti-slop/web-assertions/baseline.jsonl";
export const assertionKey = entry => JSON.stringify([entry.file, entry.test, entry.identity]);

export function readBaseline(content) {
  return content.split("\n").filter(Boolean).map(line => JSON.parse(line));
}

const cache = new Map();
export function baselineEntries(root) {
  if (!cache.has(root)) {
    const file = resolve(root, baselinePath);
    cache.set(root, existsSync(file) ? readBaseline(readFileSync(file, "utf8")) : []);
  }
  return cache.get(root);
}

/** Independent review approves the first baseline; every later head must only shrink it, or swap an identity one-to-one (swap.mjs). */
export function baselineErrors(root) {
  const entries = baselineEntries(root);
  const errors = [];
  const keys = new Set();
  for (const entry of entries) {
    const key = assertionKey(entry);
    if (Object.keys(entry).sort().join() !== "file,identity,test" ||
        typeof entry.file !== "string" || entry.file.startsWith("/") || entry.file.split("/").includes("..") || /[*?]/.test(entry.file) ||
        typeof entry.test !== "string" || !entry.test || entry.test === "*" || !/^[a-f0-9]{64}$/.test(entry.identity)) {
      errors.push("Invalid exact assertion baseline entry: " + JSON.stringify(entry));
      continue;
    }
    if (keys.has(key)) errors.push("Duplicate assertion baseline entry: " + key);
    keys.add(key);
    if (!existsSync(resolve(root, entry.file))) errors.push("Stale assertion baseline entry (file deleted): " + key);
  }
  if (!entries.length) return errors;
  const base = mergeBase(root);
  if (base.error) errors.push(base.error);
  return errors;
}

function mergeBase(root) {
  const base = spawnSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root, encoding: "utf8" });
  if (base.status !== 0) return { error: "Cannot check assertion baseline: git merge-base HEAD origin/main failed: " + base.stderr.trim() };
  const sha = base.stdout.trim();
  const object = sha + ":" + baselinePath;
  const present = spawnSync("git", ["cat-file", "-e", object], { cwd: root, encoding: "utf8" });
  return { sha, entries: present.status === 0 ? readBaseline(execFileSync("git", ["show", object], { cwd: root, encoding: "utf8" })) : null };
}

/** Head entries the merge base lacks and base entries the head dropped; null when there is no base to compare. */
export function baselineChanges(root) {
  const base = mergeBase(root);
  if (base.error || !base.entries) return null;
  const head = baselineEntries(root);
  const headKeys = new Set(head.map(assertionKey));
  const baseKeys = new Set(base.entries.map(assertionKey));
  return {
    sha: base.sha,
    added: head.filter(entry => !baseKeys.has(assertionKey(entry))),
    removed: base.entries.filter(entry => !headKeys.has(assertionKey(entry))),
  };
}

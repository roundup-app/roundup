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

/** Independent review approves the first baseline; every later head must only shrink it. */
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
  const base = spawnSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root, encoding: "utf8" });
  if (base.status !== 0) {
    errors.push("Cannot check assertion baseline: git merge-base HEAD origin/main failed: " + base.stderr.trim());
    return errors;
  }
  const object = base.stdout.trim() + ":" + baselinePath;
  const present = spawnSync("git", ["cat-file", "-e", object], { cwd: root, encoding: "utf8" });
  if (present.status === 0) {
    const original = new Set(readBaseline(execFileSync("git", ["show", object], { cwd: root, encoding: "utf8" })).map(assertionKey));
    for (const key of keys) if (!original.has(key)) errors.push("Added or broadened assertion baseline entry: " + key);
  }
  return errors;
}

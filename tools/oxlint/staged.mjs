// T5456d: the lint-staged task. Oxlint's safe fixes go onto the staged files, then the commit fails on the errors that sit on lines it adds or changes.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import parseDiff from "parse-diff";

const oxlint = resolve(fileURLToPath(new URL("../../", import.meta.url)), "node_modules/.bin/oxlint");

const files = process.argv.slice(2);

function run(command, args, statuses) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  if (result.error) throw result.error;

  if (!statuses.includes(result.status)) {
    process.stderr.write(`${command} exited ${result.status}\n${result.stdout}${result.stderr}`);
    process.exit(1);
  }

  return result;
}

// A fix moves lines, so the diagnostics come from a second run over the fixed files.
run(oxlint, ["--fix", "--no-error-on-unmatched-pattern", "--", ...files], [0, 1]);

const linted = run(oxlint, ["--no-error-on-unmatched-pattern", "-f", "json", "--", ...files], [0, 1]);

const diff = run("git", ["diff", "HEAD", "--relative", "-M", "-U0", "--no-color", "--no-ext-diff"], [0]);

const added = new Map(parseDiff(diff.stdout).map(file => [resolve(file.to), new Set(file.chunks.flatMap(chunk => chunk.changes.filter(change => change.type === "add").map(change => change.ln)))]));

function addsLine({ filename, labels }) {
  if (!labels.length) return true;

  const path = resolve(filename);
  const lines = added.get(path);

  if (!lines) return false;

  const { offset, length, line } = labels[0].span;
  const spanned = readFileSync(path).subarray(offset, offset + length).toString().split("\n").length;

  return Array.from({ length: spanned }, (_, index) => line + index).some(number => lines.has(number));
}

const failures = JSON.parse(linted.stdout).diagnostics.filter(item => item.severity === "error" && addsLine(item));

for (const { filename, labels, code, message } of failures) {
  const { line, column } = labels[0]?.span ?? {};
  process.stderr.write(`${filename}:${line ?? 0}:${column ?? 0}: error ${code}: ${message}\n`);
}

process.exit(failures.length ? 1 : 0);

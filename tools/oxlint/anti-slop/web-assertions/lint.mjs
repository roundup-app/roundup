import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineErrors, baselineChanges, baselineEntries, assertionKey } from "./baseline.mjs";
import { pairSwaps, rowsOf } from "./swap.mjs";
import { pythonAssertionKinds } from "./browser.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
const repo = resolve(directory, "../../../..");
const args = process.argv.slice(2);
const root = process.cwd();
// The ordinary gate runs the fixtures; a targeted lint invocation runs only its requested lint.
if (!args.length) {
  const fixtures = spawnSync(process.execPath, ["--test", resolve(directory, "assertions.test.mjs"), resolve(directory, "../../pre-commit.test.mjs"), resolve(directory, "../rules/u3791c-swallowed-catch.test.mjs"), resolve(directory, "../rules/u6416-state-holders.test.mjs"), resolve(directory, "../web-timeout/timeout.test.mjs")], { stdio: "inherit" });
  if (fixtures.status !== 0) process.exit(fixtures.status ?? 1);
}
const json = args.includes("json");
const ratcheted = code => /^solid\(|^typescript\(switch-exhaustiveness-check\)$|^anti-slop\((no-signal-poke|no-promise-chain-queue|no-draft-bypass|no-raw-listener|no-document-query|no-repair-effect)\)$/.test(code);
const lint = spawnSync(resolve(repo, "node_modules/.bin/oxlint"), args.length ? args : ["-f", "json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (lint.error) throw lint.error;
if (!args.length && [0, 1].includes(lint.status)) {
  // `tools/lint/scan.py oxlint` holds the Solid and exhaustiveness findings as exact debt; they never reach this status; so do the state-holder lints.
  const report = JSON.parse(lint.stdout);
  report.diagnostics = report.diagnostics.filter(item => !ratcheted(item.code));
  report.number_of_errors = report.diagnostics.filter(item => item.severity === "error").length;
  lint.status = report.number_of_errors ? 1 : 0;
  lint.stdout = JSON.stringify(report);
}
const asText = report => report.diagnostics.map(item => {
  const span = item.labels[0]?.span;
  return `${item.filename}:${span?.line ?? 0}:${span?.column ?? 0}: ${item.severity} ${item.code}: ${item.message}\n`;
}).join("");
const report = (() => { try { return JSON.parse(lint.stdout); } catch { return null; } })();
if (![0, 1].includes(lint.status)) {
  process.stdout.write(lint.stdout);
  process.stderr.write(lint.stderr);
  process.exit(lint.status ?? 1);
}
const failures = baselineErrors(root);
const inRoot = file => relative(realpathSync(root), realpathSync(resolve(root, file))).replaceAll("\\", "/");
const entryText = entry => `${entry.file} test ${entry.test} identity ${entry.identity}`;
const python = spawnSync("python3", [resolve(directory, "python-audit.py"), root], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (python.status !== 0) throw new Error(python.stderr);
const baselined = new Set(baselineEntries(root).map(assertionKey));
// Rows the head's baseline does not hold, and its entries no row matches: an edit to an owning test leaves both.
const fresh = [];
const stale = [];
const observedPython = new Set();
for (const line of python.stdout.split("\n").filter(Boolean)) {
  const row = JSON.parse(line);
  const kinds = pythonAssertionKinds(row);
  if (!kinds.length) continue;
  const key = assertionKey(row);
  observedPython.add(key);
  if (!baselined.has(key)) fresh.push({ file: row.file, test: row.test, identity: row.identity, kinds, assertion: row.assertion, python: true });
}
for (const entry of baselineEntries(root)) if (entry.file.endsWith(".py") && !observedPython.has(assertionKey(entry))) stale.push({ ...entry, python: true });
for (const item of report?.diagnostics ?? []) {
  if (item.code !== "anti-slop(no-new-web-assertions)") continue;
  if (item.message.startsWith("Stale assertion baseline entry: ")) {
    const [file, test, identity] = JSON.parse(item.message.slice("Stale assertion baseline entry: ".length));
    stale.push({ file, test, identity, item });
  } else {
    const { test, identity, kinds, assertion } = JSON.parse(item.message);
    fresh.push({ file: inRoot(item.filename), test, identity, kinds, assertion, item });
  }
}
const changes = baselineChanges(root);
const swapped = new Set();
const handled = new Set();
if (changes && changes.added.length && changes.removed.length) {
  const pairs = pairSwaps(rowsOf(root, changes.sha, changes.removed), rowsOf(root, null, changes.added));
  for (const [, row] of pairs) swapped.add(assertionKey(row));
}
for (const entry of changes?.added ?? []) if (!swapped.has(assertionKey(entry))) failures.push("Added or broadened assertion baseline entry: " + assertionKey(entry));
if (changes && stale.length && fresh.length) {
  for (const [old, row] of pairSwaps(rowsOf(root, changes.sha, stale), fresh)) {
    const entry = stale.find(item => item.file === old.file && item.identity === old.identity);
    const replacement = fresh.find(item => item.file === row.file && item.identity === row.identity);
    handled.add(entry).add(replacement);
    failures.push(`Assertion baseline entry swap: ${entryText(entry)} is stale after an edit to its test; its replacement is identity ${replacement.identity}`);
  }
}
for (const row of fresh) if (row.python && !handled.has(row)) failures.push("New Python appearance/copy assertion: " + assertionKey(row));
for (const entry of stale) if (entry.python && !handled.has(entry)) failures.push("Stale Python assertion baseline entry: " + assertionKey(entry));
if (report) {
  const before = report.diagnostics.length;
  report.diagnostics = report.diagnostics.filter(item => ![...handled].some(row => row.item === item));
  if (report.diagnostics.length !== before) {
    report.number_of_errors = report.diagnostics.filter(item => item.severity === "error").length;
    lint.status = report.number_of_errors ? 1 : 0;
  }
}
if (json) {
  report.diagnostics.push(...failures.map(message => ({ message, code: "anti-slop(assertion-baseline)", severity: "error", filename: relative(root, resolve(root, "tools/oxlint/anti-slop/web-assertions/baseline.jsonl")), labels: [] })));
  report.number_of_errors = report.diagnostics.filter(item => item.severity === "error").length;
  process.stdout.write(JSON.stringify(report));
} else {
  process.stdout.write(report ? asText(report) : lint.stdout);
  for (const failure of failures) process.stderr.write(failure + "\n");
}
process.stderr.write(lint.stderr);
const debt = args.length ? { status: 0 } : spawnSync("python3", [resolve(repo, "tools/lint/scan.py"), "oxlint", "--root", root], { stdio: "inherit" });
process.exit(lint.status || (failures.length ? 1 : 0) || (debt.status ?? 2));

import { spawnSync } from "node:child_process";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineErrors, baselineEntries, assertionKey } from "./baseline.mjs";
import { pythonAssertionKinds } from "./browser.mjs";

const directory = fileURLToPath(new URL("./", import.meta.url));
const repo = resolve(directory, "../../../..");
const args = process.argv.slice(2);
const root = process.cwd();
// The ordinary gate runs the fixtures; a targeted lint invocation runs only its requested lint.
if (!args.length) {
  const fixtures = spawnSync(process.execPath, ["--test", resolve(directory, "assertions.test.mjs"), resolve(directory, "../../pre-commit.test.mjs"), resolve(directory, "../rules/u3791c-swallowed-catch.test.mjs"), resolve(directory, "../web-timeout/timeout.test.mjs")], { stdio: "inherit" });
  if (fixtures.status !== 0) process.exit(fixtures.status ?? 1);
}
const json = args.includes("json");
const lint = spawnSync(resolve(repo, "node_modules/.bin/oxlint"), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (lint.error) throw lint.error;
if (![0, 1].includes(lint.status)) {
  process.stdout.write(lint.stdout);
  process.stderr.write(lint.stderr);
  process.exit(lint.status ?? 1);
}
const failures = baselineErrors(root);
const python = spawnSync("python3", [resolve(directory, "python-audit.py"), root], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (python.status !== 0) throw new Error(python.stderr);
const observedPython = new Set();
for (const line of python.stdout.split("\n").filter(Boolean)) {
  const row = JSON.parse(line);
  if (!pythonAssertionKinds(row).length) continue;
  const key = assertionKey(row);
  observedPython.add(key);
  if (!baselineEntries(root).some(entry => assertionKey(entry) === key)) failures.push("New Python appearance/copy assertion: " + key);
}
for (const entry of baselineEntries(root)) {
  if (entry.file.endsWith(".py") && !observedPython.has(assertionKey(entry))) failures.push("Stale Python assertion baseline entry: " + assertionKey(entry));
}
if (json) {
  const report = JSON.parse(lint.stdout);
  report.diagnostics.push(...failures.map(message => ({ message, code: "anti-slop(assertion-baseline)", severity: "error", filename: relative(root, resolve(root, "tools/oxlint/anti-slop/web-assertions/baseline.jsonl")), labels: [] })));
  report.number_of_errors = report.diagnostics.filter(item => item.severity === "error").length;
  process.stdout.write(JSON.stringify(report));
} else {
  process.stdout.write(lint.stdout);
  for (const failure of failures) process.stderr.write(failure + "\n");
}
process.stderr.write(lint.stderr);
process.exit(lint.status || (failures.length ? 1 : 0));

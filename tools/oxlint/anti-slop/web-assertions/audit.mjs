import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pythonAssertionKinds } from "./browser.mjs";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = "tools/oxlint/anti-slop/web-assertions";
const args = ["--silent", "exec", "oxlint", "--config", directory + "/audit.json", "--format", "json", "apps/desktop/src"];
const result = spawnSync("pnpm", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (result.error) throw result.error;
if (![0, 1].includes(result.status)) throw new Error(result.stdout + result.stderr);
const report = JSON.parse(result.stdout);
const diagnostics = report.diagnostics.filter(item => item.code === "anti-slop(audit-web-assertions)");
const unrelated = report.diagnostics.filter(item => item.severity === "error" && item.code !== "anti-slop(audit-web-assertions)");
if (unrelated.length || !report.number_of_files) throw new Error(JSON.stringify(unrelated) + result.stderr);
const observations = diagnostics.map(item => ({
  file: item.filename, line: item.labels[0].span.line, column: item.labels[0].span.column,
  ...JSON.parse(item.message),
}));
const python = execFileSync("python3", [directory + "/python-audit.py", "apps/desktop/src"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
for (const line of python.split("\n").filter(Boolean)) {
  const item = JSON.parse(line);
  const kinds = pythonAssertionKinds(item);
  observations.push({ ...item, kinds: kinds.length ? kinds : ["python-behavior"], file: "apps/desktop/src/" + item.file });
}
observations.sort((a, b) => a.file.localeCompare(b.file, "en") || a.line - b.line || (a.column ?? 0) - (b.column ?? 0));
const hash = createHash("sha256");
for (const file of [".oxlintrc.json", "package.json", "apps/desktop/package.json", "pnpm-lock.yaml", directory + "/audit.mjs", directory + "/audit.json", directory + "/rule.mjs", directory + "/browser.mjs", directory + "/baseline.mjs", directory + "/lint.mjs", directory + "/python-audit.py", "tools/oxlint/anti-slop/shared/scope.ts", "tools/oxlint/anti-slop/shared/array-method.ts", "tools/oxlint/anti-slop/index.ts"]) {
  hash.update(file + "\0").update(readFileSync(resolve(repo, file))).update("\0");
}
const files = execFileSync("git", ["ls-files", "apps/desktop/src"], { cwd: repo, encoding: "utf8" }).trim().split("\n");
const sourceHash = createHash("sha256");
for (const file of files) sourceHash.update(file + "\0").update(readFileSync(resolve(repo, file))).update("\0");
console.log(JSON.stringify({
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  sourceModified: spawnSync("git", ["diff", "--quiet", "HEAD", "--", "apps/desktop/src"], { cwd: repo }).status !== 0,
  toolVersions: {
    oxlint: JSON.parse(readFileSync(resolve(repo, "node_modules/oxlint/package.json"), "utf8")).version,
    plugins: JSON.parse(readFileSync(resolve(repo, "node_modules/@oxlint/plugins/package.json"), "utf8")).version,
    babelParser: JSON.parse(readFileSync(resolve(repo, "apps/desktop/node_modules/@babel/parser/package.json"), "utf8")).version,
    babelTypes: JSON.parse(readFileSync(resolve(repo, "apps/desktop/node_modules/@babel/types/package.json"), "utf8")).version,
    python: execFileSync("python3", ["--version"], { encoding: "utf8" }).trim(),
  },
  pythonFiles: files.filter(file => file.endsWith(".test.py")).length,
  pythonAssertions: observations.filter(item => item.file.endsWith(".py")).length,
  sourceHash: sourceHash.digest("hex"), toolHash: hash.digest("hex"), command: "pnpm " + args.join(" "), exitCode: result.status,
  analyzedFiles: report.number_of_files, observations: observations.length, files: new Set(observations.map(item => item.file)).size,
  note: "Source observations for reviewing the exact baseline. Python behavior observations are not baseline exceptions.",
}));
for (const item of observations) console.log(JSON.stringify(item));

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const config = "tools/oxlint/anti-slop/web-timeout/audit.json";
const args = ["--silent", "lint", "--config", config, "--format", "json", "apps/desktop/src", "apps/desktop/vite.config.ts"];
const result = spawnSync("pnpm", args, { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
if (result.error) throw result.error;
if (![0, 1].includes(result.status)) throw new Error(result.stdout + result.stderr);
const report = JSON.parse(result.stdout);
const diagnostics = report.diagnostics.filter(item => item.code === "anti-slop(bounded-test-timeout)");
const unrelated = report.diagnostics.filter(item => item.severity === "error" && item.code !== "anti-slop(bounded-test-timeout)");
if (unrelated.length || !report.number_of_files) throw new Error(JSON.stringify(unrelated) + result.stderr);
const hash = createHash("sha256");
for (const file of [config, "tools/oxlint/anti-slop/web-timeout/rule.mjs", "tools/oxlint/anti-slop/shared/scope.ts", "tools/oxlint/anti-slop/shared/array-method.ts", "tools/oxlint/anti-slop/index.ts"]) {
  hash.update(file + "\0").update(readFileSync(resolve(repo, file))).update("\0");
}
console.log(JSON.stringify({
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  sourceModified: spawnSync("git", ["diff", "--quiet", "HEAD", "--", "apps/desktop/src", "apps/desktop/vite.config.ts"], { cwd: repo }).status !== 0,
  toolHash: hash.digest("hex"), command: "pnpm " + args.join(" "), exitCode: result.status,
  analyzedFiles: report.number_of_files, observations: diagnostics.length, files: new Set(diagnostics.map(item => item.filename)).size,
}));
for (const item of diagnostics.sort((a, b) => a.filename.localeCompare(b.filename, "en") || a.labels[0].span.offset - b.labels[0].span.offset)) {
  const span = item.labels[0].span;
  console.log(JSON.stringify({ file: item.filename, line: span.line, column: span.column, diagnostic: item.message }));
}

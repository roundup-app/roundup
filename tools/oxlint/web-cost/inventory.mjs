import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const { values } = parseArgs({ options: { source: { type: "string" } } });
const source = resolve(values.source ?? join(repo, "apps/desktop/src"));
const temporary = mkdtempSync(join(tmpdir(), "web-cost-oxlint-"));

function parseFiles() {
  const config = join(temporary, "oxlint.json");
  writeFileSync(config, JSON.stringify({
    categories: { correctness: "off" },
    plugins: [],
    jsPlugins: [{ name: "web-cost", specifier: fileURLToPath(new URL("./imports.mjs", import.meta.url)) }],
    rules: { "web-cost/imports": "warn" },
  }));
  const output = execFileSync(process.execPath, [join(dirname(require.resolve("oxlint/package.json")), "bin/oxlint"), "--config", config, "--no-ignore", "--format", "json", source], { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const result = JSON.parse(output);
  if (result.diagnostics.some(diagnostic => diagnostic.severity === "error")) {
    throw new Error(`Oxlint could not inventory the source: ${output}`);
  }
  return result.diagnostics.map(diagnostic => ({
    file: relative(source, resolve(repo, diagnostic.filename)).replaceAll("\\", "/"),
    ...JSON.parse(diagnostic.message),
  }));
}

function localModule(file, specifier, modules) {
  const base = resolve(source, dirname(file), specifier);
  // TS permits .js import specifiers for a .ts/.tsx implementation.
  const stem = base.replace(/\.[cm]?jsx?$/, "");
  const candidates = [base, ...[stem, base].flatMap(name => [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"].map(extension => name + extension))];
  return candidates.map(candidate => relative(source, candidate).replaceAll("\\", "/")).find(candidate => modules.has(candidate));
}

function route(file, modules, roots, visited = new Set()) {
  if (roots.includes(file)) return [file];
  if (visited.has(file)) return null;
  visited.add(file);
  for (const imported of modules.get(file)?.dependencies ?? []) {
    const tail = route(imported, modules, roots, visited);
    if (tail) return [file, ...tail];
  }
  return null;
}

try {
  if (!existsSync(source)) throw new Error(`Missing source directory: ${source}`);
  const parsed = parseFiles().sort((left, right) => left.file.localeCompare(right.file, "en"));
  const modules = new Map(parsed.map(module => [module.file, module]));
  const unresolved = [];
  for (const module of parsed) {
    module.dependencies = [];
    for (const imported of module.imports) {
      if (imported.specifier === null) {
        unresolved.push({ file: module.file, line: imported.line, expression: imported.expression });
      } else if (imported.specifier.startsWith(".")) {
        const target = localModule(module.file, imported.specifier, modules);
        if (target) module.dependencies.push(target);
        // Non-code assets are not fixture modules. Imports outside src are
        // reported: their graph has not been parsed and is not assumed empty.
        else if (!/\.(?:css|json|svg|png|woff2?|ttf)(?:\?.*)?$/.test(imported.specifier)) {
          unresolved.push({ file: module.file, line: imported.line, expression: imported.specifier });
        }
      }
    }
  }
  const roots = ["testing/realDaemonFixture.ts", "testing/realDaemonPlugin.ts"].filter(file => modules.has(file));
  if (!roots.length) throw new Error("No known real-Daemon fixture root found");
  const consumers = [];
  const evidence = new Set();
  for (const module of parsed) {
    if (!/\.test\.[cm]?[jt]sx?$/.test(module.file)) continue;
    const path = route(module.file, modules, roots);
    if (!path) continue;
    for (const part of path) evidence.add(part);
    consumers.push({ file: module.file, tests: module.tests.map(test => test.name), registrations: module.tests, path });
  }
  const sourceHash = createHash("sha256");
  for (const module of parsed) {
    sourceHash.update(module.file + "\0").update(readFileSync(join(source, module.file))).update("\0");
  }
  console.log(JSON.stringify({
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    sourceHash: sourceHash.digest("hex"),
    roots,
    complete: unresolved.length === 0,
    unresolved,
    consumers,
    evidence: [...evidence].sort(),
    parsedFiles: parsed.length,
  }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

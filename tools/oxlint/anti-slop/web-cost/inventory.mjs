import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

const appRequire = createRequire(join(repo, "apps/desktop/package.json"));

const { createVitest } = await import(appRequire.resolve("vitest/node"));

const { default: solid } = await import(appRequire.resolve("vite-plugin-solid"));

const fixtureRoots = ["testing/realDaemonFixture.ts", "testing/realDaemonPlugin.ts"];

function route(module, roots, visited = new Set()) {
  if (!module || visited.has(module.id)) return null;

  if (roots.includes(module.file)) return [module.file];
  visited.add(module.id);

  for (const imported of module.importedModules) {
    const tail = route(imported, roots, visited);

    if (tail) return [module.file, ...tail];
  }

  return null;
}

/** Inventory static fixture consumers without evaluating their modules or hooks. */
export async function inventory(source = join(repo, "apps/desktop/src")) {
  source = resolve(source);
  const roots = fixtureRoots.values().map(file => join(source, file)).filter(existsSync).toArray();

  if (!roots.length) throw new Error("No known real-Daemon fixture root found");

  // No App config: its global setup warms Chromium. Use only the installed
  // Solid transform; discovery and static parsing never collect/run a test.
  const vitest = await createVitest({
    root: source,
    config: false,
    watch: false,
    related: roots,
    include: ["**/*.test.{ts,tsx}"],
  }, { plugins: [solid()] });

  try {
    const specs = await vitest.getRelevantTestSpecifications();
    const graphs = vitest.projects.map(project => project.vite.environments.ssr.moduleGraph);

    for (const graph of graphs) {
      for (const module of graph.idToModuleMap.values()) {
        if (module.file?.startsWith(".") || (module.file?.startsWith(source + "/") && !existsSync(module.file))) {
          throw new Error(`Unresolved runtime dependency: ${module.file}`);
        }
      }
    }

    const modules = await vitest.parseSpecifications(specs);
    const short = file => relative(source, file).replaceAll("\\", "/");

    const consumers = modules.map(module => {
      if (module.errors().length) throw new Error(`Cannot statically parse ${module.moduleId}: ${JSON.stringify(module.errors())}`);
      const spec = module.toTestSpecification();
      const graph = spec.project.vite.environments.ssr.moduleGraph;
      const path = route(graph.getModuleById(module.moduleId), roots);

      if (!path) throw new Error(`Vitest selected ${module.moduleId} without a fixture path`);

      return {
        file: short(module.moduleId),
        tests: [...module.children.allTests()].map(test => test.name),
        path: path.map(short),
      };
    }).sort((left, right) => left.file.localeCompare(right.file, "en"));

    const evidence = [...new Set(consumers.flatMap(consumer => consumer.path))].sort();

    // Hash every source module Vite inspected, not only the example paths.
    const files = [...new Set(specs.flatMap(spec => [...spec.project.vite.environments.ssr.moduleGraph.idToModuleMap.values()]
      .flatMap(module => module.file && module.file.startsWith(source + "/") && existsSync(module.file) ? [module.file] : [])))].sort();

    const sourceHash = createHash("sha256");

    for (const file of files) sourceHash.update(short(file) + "\0").update(readFileSync(file)).update("\0");

    return { roots: roots.map(short), consumers, evidence, sourceHash: sourceHash.digest("hex"), parsedFiles: files.length };
  } finally {
    await vitest.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: "string" } } });
  console.log(JSON.stringify({
    toolRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    toolModified: execFileSync("git", ["status", "--porcelain", "--", relative(repo, fileURLToPath(import.meta.url))], { cwd: repo, encoding: "utf8" }).length > 0,
    sourceRevision: values.source ? null : execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    sourceModified: values.source ? null : execFileSync("git", ["status", "--porcelain", "--", "apps/desktop/src"], { cwd: repo, encoding: "utf8" }).length > 0,
    ...await inventory(values.source),
  }, null, 2));
}

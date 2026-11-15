import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The modules that start Chrome and the App server: a test file that reaches either needs them warm before it runs. */
const BROWSER_MODULES = ["src/testing/chromePage.ts", "src/testing/appServer.ts"];

const IMPORT = /\b(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g;

const SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * T7187a: the test files, relative to `root`, whose imports reach `chromePage` or `appServer`. Only a run holding one of
 * them needs the Chrome and App server that `warmChrome` and `globalAppServer` start before its first file.
 */
export function browserTests(root: string): string[] {
  const modules = new Set(globSync("src/**/*.{ts,tsx}", { cwd: root }));
  const importers = new Map<string, string[]>();

  // A renamed module would otherwise send every browser test to the project that starts neither.
  for (const entry of BROWSER_MODULES) if (!modules.has(entry)) throw new Error(`${entry} is missing: browserTests names the modules that start Chrome and the App server`);

  for (const file of modules) {
    for (const [, specifier] of readFileSync(join(root, file), "utf8").matchAll(IMPORT)) {
      const target = SUFFIXES.map((suffix) => join(dirname(file), specifier + suffix)).find((path) => modules.has(path));

      if (target) importers.set(target, [...(importers.get(target) ?? []), file]);
    }
  }

  const reached = new Set(BROWSER_MODULES);

  for (const entry of reached) for (const importer of importers.get(entry) ?? []) reached.add(importer);

  return [...reached].filter((file) => /\.test\.tsx?$/.test(file)).sort();
}

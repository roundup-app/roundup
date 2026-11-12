import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

// U4709d: every App stylesheet loads at start, except one listed with the library stylesheet that loads in the same lazy chunk.
// Static reading of the import graph with the TypeScript parser: no build, browser or test run.
const root = resolve(process.argv[2] ?? '.');

const src = resolve(root, 'apps/desktop/src');

const listed = JSON.parse(readFileSync(resolve(process.argv[3] ?? new URL('./lazy-sheets.json', import.meta.url).pathname), 'utf8'));

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

const resolveRelative = (from, specifier) => {
  const base = resolve(dirname(from), specifier.replace(/\?.*$/, ''));
  const hit = EXTENSIONS.map((extension) => base + extension).find((path) => existsSync(path) && !path.endsWith('/') && /\.(tsx?|css)$/.test(path));

  if (!hit) throw new Error(`unresolved import ${specifier} in ${relative(src, from)}`);

  return hit;
};

const imports = new Map();

const read = (file) => {
  if (imports.has(file)) return imports.get(file);

  const edges = [];
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  if (source.parseDiagnostics.length) throw new Error(`failed to parse ${relative(src, file)}`);

  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && !node.isTypeOnly) edges.push({ specifier: node.moduleSpecifier.text, dynamic: false });
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(node.arguments[0])) edges.push({ specifier: node.arguments[0].text, dynamic: true });

    ts.forEachChild(node, visit);
  };

  visit(source);
  imports.set(file, edges);

  return edges;
};

// A `?inline` sheet is a string, not a loaded stylesheet.
const isSheet = (specifier) => specifier.endsWith('.css');

const local = (specifier) => specifier.startsWith('.');

const reach = (entry, followDynamic) => {
  const seen = new Set([entry]);
  const queue = [entry];

  for (const file of queue) {
    if (file.endsWith('.css')) continue;

    for (const edge of read(file)) {
      if (!local(edge.specifier) || (edge.dynamic && !followDynamic) || /\.(png|svg|json)(\?|$)/.test(edge.specifier)) continue;

      const target = resolveRelative(file, edge.specifier);

      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }

  return seen;
};

const failures = [];

try {
  const entry = resolve(src, 'main.tsx');
  const eager = reach(entry, false);
  const everything = reach(entry, true);

  for (const file of everything) {
    if (file.endsWith('.css') || eager.has(file)) continue;

    for (const edge of read(file)) {
      if (!local(edge.specifier) || !isSheet(edge.specifier)) continue;

      const sheet = relative(src, resolveRelative(file, edge.specifier));

      if (eager.has(resolve(src, sheet)) || sheet in listed) continue;
      failures.push(`${sheet} loads only with the lazy chunk of ${relative(src, file)}: import it from main.tsx, or list it with its library in tools/lint/lazy-sheets.json`);
    }
  }

  for (const [sheet, library] of Object.entries(listed)) {
    const importers = [...everything].filter((file) => !file.endsWith('.css') && read(file).some((edge) => local(edge.specifier) && isSheet(edge.specifier) && resolve(dirname(file), edge.specifier) === resolve(src, sheet)));

    if (!importers.some((file) => read(file).some((edge) => edge.specifier === library))) failures.push(`${sheet} is listed with ${library}, which no module importing it also imports`);
  }
} catch (error) {
  console.error(`eager-sheets: ${error.message}`);
  process.exit(2);
}

for (const failure of failures) console.error(`eager-sheets: ${failure}`);

process.exitCode = failures.length ? 1 : 0;

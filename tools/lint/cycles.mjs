import madge from 'madge';
import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

try {
  const root = resolve(process.argv[2] ?? '.');

  const configPath = resolve(root, 'apps/desktop/tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);

  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));

  if (parsed.errors.length) throw new Error(ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, '\n'));

  const graph = await madge(resolve(root, 'apps/desktop/src'), {
    baseDir: resolve(root, 'apps/desktop/src'),
    fileExtensions: ['ts', 'tsx'],
    dependencyFilter: (path) => /\.tsx?$/.test(path),
    tsConfig: resolve(root, 'apps/desktop/tsconfig.json'),
    detectiveOptions: { ts: { skipTypeImports: false }, tsx: { skipTypeImports: false } },
  });

  const unresolved = graph.warnings().skipped.filter((path) => path.startsWith('.') && !path.includes('node_modules/') && !/\.css(?:\?|$)/.test(path));

  if (unresolved.length) throw new Error(`unresolved imports: ${unresolved.join(', ')}`);

  for (const file of Object.keys(graph.obj())) {
    const path = resolve(root, 'apps/desktop/src', file);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);

    if (source.parseDiagnostics.length) throw new Error(`failed to parse ${file}: ${ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, '\n')}`);
  }

  const cycles = graph.circular();

  // Directory mode: no two top-level directories import each other. Production files only, so a test or a harness may cross directories.
  const directory = (file) => (file.includes('/') ? file.split('/')[0] : null);
  const edges = new Set();

  for (const [file, imports] of Object.entries(graph.obj())) {
    if (/(?:\.test|Harness|Fixture)\.tsx?$/.test(file) || file.startsWith('testing/')) continue;

    for (const target of imports) {
      const [from, to] = [directory(file), directory(target)];

      if (from && to && from !== to) edges.add(`${from}>${to}`);
    }
  }

  const pairs = [...edges].flatMap((edge) => {
    const [a, b] = edge.split('>');

    return a < b && edges.has(`${b}>${a}`) ? [`${a}<>${b}`] : [];
  }).sort();

  const baselinePath = resolve(root, 'tools/lint/directory-pairs.json');
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : [];
  const added = pairs.filter((pair) => !baseline.includes(pair));
  const stale = baseline.filter((pair) => !pairs.includes(pair));

  console.log(JSON.stringify({ tool: 'madge 8.0.0', cycles, directoryPairs: { added, stale } }));

  if (stale.length) console.error(`directory pairs repaired, remove from tools/lint/directory-pairs.json: ${stale.join(', ')}`);
  process.exitCode = cycles.length || added.length || stale.length ? 1 : 0;
} catch (error) {
  console.error(`madge: ${error.message}`);
  process.exitCode = 2;
}

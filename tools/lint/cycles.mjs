import madge from 'madge';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
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
  console.log(JSON.stringify({ tool: 'madge 8.0.0', cycles }));
  process.exitCode = cycles.length ? 1 : 0;
} catch (error) {
  console.error(`madge: ${error.message}`);
  process.exitCode = 2;
}

import ts from 'typescript-analysis';
import { resolve } from 'node:path';

/** Lazily supplies compiler-proven keys; a broad string or any is never a key inventory. */
export function copyKeyTypes(files, root) {
  let program;
  const sources = new Map(Object.entries(files).map(([file, source]) => [resolve(root, file), source]));

  const options = {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve,
    jsxImportSource: 'solid-js', strict: true, skipLibCheck: true, types: [],
    baseUrl: resolve(root, '..'), paths: { '@contracts/*': ['../../contracts/generated/*'] },
  };

  return (file, start, end) => {
    if (!program) {
      const host = ts.createCompilerHost(options);
      const exists = host.fileExists;
      const read = host.readFile;
      const directoryExists = host.directoryExists;
      host.directoryExists = directory => [...sources.keys()].some(file => file.startsWith(resolve(directory) + "/")) || directoryExists(directory);
      host.fileExists = file => sources.has(resolve(file)) || exists(file);
      host.readFile = file => sources.get(resolve(file)) ?? read(file);
      host.getSourceFile = (file, version) => {
        const source = host.readFile(file);

        return source === undefined ? undefined : ts.createSourceFile(file, source, version, true);
      };

      program = ts.createProgram([...sources.keys()].filter(file => /\.tsx?$/.test(file) && !/\.test\./.test(file)), options, host);
    }

    const source = program.getSourceFile(resolve(root, file));

    if (!source) return null;
    let expression;

    const find = node => {
      if (node.pos > start || node.end < end) return;

      if (node.getStart(source) === start && node.end === end) expression = node;
      ts.forEachChild(node, find);
    };

    find(source);

    if (!expression) return null;
    const type = program.getTypeChecker().getTypeAtLocation(expression);
    const alternatives = type.isUnion() ? type.types : [type];

    return alternatives.every(each => each.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral))
      ? alternatives.map(each => String(each.value)) : null;
  };
}

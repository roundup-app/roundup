import { language } from "./language.mjs";
import { createHash } from 'node:crypto';
import { templates } from "./templates.mjs";
import { parse } from '@babel/parser';
import traversal from '@babel/traverse';
import { posix } from 'node:path';

const traverse = traversal.default ?? traversal;

const catalogue = file => /(^|\/)copy\.ts$|^sharedCopy\.ts$/.test(file);

const production = file => !/(\.test\.|Fixture|Browser|Harness|^testing\/|^perf\/|\.d\.ts$)/.test(file);

const owner = file => file.includes('/') ? file.split('/')[0] : 'app';

const key = node => node?.type === 'Identifier' ? node.name : node?.value;

const unwrap = path => path?.isTSAsExpression() || path?.isTSSatisfiesExpression() ? unwrap(path.get('expression')) : path;

/** Inspect resolved production reads; tests never make an otherwise dead entry live. */
export function checkCopy(files, glossary = "", { ownershipOnly = false } = {}) {
  const diagnostics = [];
  const modules = new Map();
  const report = (file, rule, identity, text) => diagnostics.push({ file, rule, identity, text });

  for (const [file, source] of Object.entries(files)) {
    if (!production(file)) continue;
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const exports = new Map();
    traverse(ast, { ExportNamedDeclaration(path) {
      const declaration = path.get('declaration');

      if (!declaration.isVariableDeclaration()) return;

      for (const item of declaration.get('declarations')) if (item.get('id').isIdentifier()) exports.set(item.node.id.name, unwrap(item.get('init')));
    } });
    modules.set(file, { ast, exports });

    if (catalogue(file) && (file === 'copy.ts' || source.split('\n').length > 1000)) report(file, 'ownership', 'copy', 'Root catalogue or catalogue over 1000 lines');
  }

  const importedFile = (file, source) => {
    const base = posix.normalize(posix.join(posix.dirname(file), source));

    return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(candidate => modules.has(candidate));
  };

  const resolve = (path, file, seen = new Set()) => {
    path = unwrap(path);

    if (!path?.node || seen.has(path.node)) return null;
    seen = new Set([...seen, path.node]);

    if (path.isMemberExpression()) {
      const base = resolve(path.get('object'), file, seen);

      if (!base) return null;
      const property = path.node.computed ? path.node.property.type === 'StringLiteral' ? path.node.property.value : null : key(path.node.property);

      return { ...base, keys: [...base.keys, property] };
    }

    if (!path.isIdentifier()) return null;
    const binding = path.scope.getBinding(path.node.name);

    if (!binding) return null;
    const at = binding.path;

    if (at.isImportSpecifier()) {
      const target = importedFile(file, at.parent.source.value);

      return target && catalogue(target) ? { file: target, name: key(at.node.imported), keys: [] } : null;
    }

    if (!at.isVariableDeclarator()) return null;

    if (catalogue(file) && at.scope === at.scope.getProgramParent()) return { file, name: path.node.name, keys: [] };
    const base = resolve(at.get('init'), file, seen);

    if (!base || !at.get('id').isObjectPattern()) return base;
    const property = at.node.id.properties.find(each => each.type === 'ObjectProperty' && (each.value.name === path.node.name || each.value.type === 'AssignmentPattern' && each.value.left.name === path.node.name));

    return property ? { ...base, keys: [...base.keys, key(property.key)] } : null;
  };

  const definitions = new Map();

  const define = (identity, file, name, path) => {
    path = unwrap(path);
    const reads = new Set();
    definitions.set(identity, { file, name, path, reads });

    if (path.isObjectExpression()) for (const property of path.get('properties')) {
      if (!property.isObjectProperty()) { report(file, 'ownership', name, 'Whole catalogue spreads are forbidden'); continue; }

      const child = `${identity}.${key(property.node.key)}`;
      reads.add(child);
      define(child, file, `${name}.${key(property.node.key)}`, property.get('value'));
    }
  };

  for (const [file, module] of modules) {
    if (!catalogue(file)) continue;
    traverse(module.ast, { VariableDeclarator(path) {
      if (path.scope !== path.scope.getProgramParent() || !path.get('id').isIdentifier() || !path.node.init || path.node.id.name === 'copy') return;
      define(`${file}:${path.node.id.name}`, file, path.node.id.name, path.get('init'));
    } });

    for (const [name, path] of module.exports) {
      if (name !== 'copy') continue;

      if (!path.isObjectExpression()) { report(file, 'ownership', name, 'Catalogue must declare its entries'); continue; }

      for (const property of path.get('properties')) {
        if (!property.isObjectProperty()) { report(file, 'ownership', name, 'Whole catalogue spreads are forbidden'); continue; }

        const entry = key(property.node.key);
        define(`${file}:copy.${entry}`, file, entry, property.get('value'));
      }
    }
  }

  const live = new Set();
  const roots = [];

  for (const [file, module] of modules) {
    if (!production(file)) continue;
    traverse(module.ast, {
      ImportDeclaration(path) {
        const target = importedFile(file, path.node.source.value);

        if (!target || !catalogue(target)) return;

        if (catalogue(file)) {
          if (target !== 'sharedCopy.ts') report(file, 'ownership', path.node.source.value, 'Catalogues may import only shared copy');
        } else if (target !== `${owner(file)}/copy.ts`) report(file, 'ownership', path.node.source.value, 'Caller must import its own surface catalogue');
      },
      'MemberExpression|ReferencedIdentifier'(path) {
        if (path.parentPath.isMemberExpression() && path.parent.object === path.node) return;

        if (path.parentPath.isVariableDeclarator() && path.parent.init === path.node) return;
        const ref = resolve(path, file);

        if (!ref) return;
        let identity = `${ref.file}:${ref.name}`;

        for (const part of ref.keys) {
          if (part == null || !definitions.has(`${identity}.${part}`)) break;
          identity += `.${part}`;
        }

        if (ref.name === 'copy' && (ref.keys[0] == null)) {
          report(file, 'dynamic', path.node.start, 'Unresolved catalogue read');

          return;
        }

        if (!definitions.has(identity)) { report(file, 'missing', identity, 'Catalogue entry does not exist');

 return; }

        const enclosing = [...definitions.values()].find(entry => entry.file === file && path.node.start >= entry.path.node.start && path.node.end <= entry.path.node.end);

        if (enclosing) enclosing.reads.add(identity);
        else { live.add(identity);

 if (!catalogue(file)) roots.push([identity, owner(file)]); }
      },
    });
  }

  const mark = identity => {
    for (const next of definitions.get(identity)?.reads ?? []) if (!live.has(next)) { live.add(next); mark(next); }
  };

  for (const identity of live) mark(identity);

  for (const [identity, entry] of definitions) if (!live.has(identity) && ![...live].some(other => other.startsWith(`${identity}.`))) report(entry.file, 'unused', identity, 'No reachable production read');
  const consumers = new Map();

  const consume = (identity, surface, seen = new Set()) => {
    if (seen.has(identity)) return;
    seen.add(identity);

    if (!consumers.has(identity)) consumers.set(identity, new Set());
    consumers.get(identity).add(surface);

    for (const next of definitions.get(identity)?.reads ?? []) consume(next, surface, seen);
  };

  for (const [identity, surface] of roots) consume(identity, surface);

  for (const [identity, entry] of definitions) if (entry.file === 'sharedCopy.ts' && live.has(identity) && (consumers.get(identity)?.size ?? 0) < 2) report(entry.file, 'ownership', identity, 'Shared copy needs multiple production surfaces');

  if (ownershipOnly) return diagnostics;
  const fileFor = new Map([...modules].map(([file, module]) => [module.ast.program, file]));

  const lookup = path => {
    const file = fileFor.get(path.scope.getProgramParent().path.node);
    const ref = resolve(path, file);

    if (ref) return definitions.get(`${ref.file}:${ref.name}${ref.name === 'copy' && ref.keys.length ? `.${ref.keys[0]}` : ''}`)?.path;

    if (path.isIdentifier()) {
      const binding = path.scope.getBinding(path.node.name);

      if (binding?.path.isVariableDeclarator()) return unwrap(binding.path.get('init'));
    }

    return null;
  };

  const outputs = new Map();

  for (const [identity, entry] of definitions) {
    if (!live.has(identity) || entry.path.isObjectExpression() || entry.path.isIdentifier() || entry.path.isMemberExpression()) continue;
    const values = templates(entry.path, lookup);

    for (const [branch, { text, origin }] of values.entries()) {
      const fingerprint = createHash('sha256').update(text).digest('hex');
      const detail = () => { const diagnostic = diagnostics.at(-1); diagnostic.identity = entry.name; diagnostic.branch = branch; diagnostic.fingerprint = fingerprint; };

      if (!/[a-zA-Z]/.test(text)) continue;
      const previous = outputs.get(text) ?? new Map();

      for (const [otherOrigin, otherName] of previous) if (otherOrigin !== origin) {
        report(entry.file, 'duplicate', identity, `Duplicates ${otherName}: ${text}`);
        detail();
        diagnostics.at(-1).identity = [entry.name, otherName].sort().join('|');
        diagnostics.at(-1).branch = 0;
      }

      previous.set(origin, entry.name);
      outputs.set(text, previous);

      for (const diagnostic of language(text, glossary)) { report(entry.file, diagnostic.rule, identity, diagnostic.text); detail(); }
    }
  }

  return diagnostics;
}

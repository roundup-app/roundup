import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { avoidedWords, languageProblems } from './grammar.mjs';
import { copyKeyTypes } from './types.mjs';
import { inventory, applyBaseline } from './baseline.mjs';

const traverse = traverseModule.default ?? traverseModule;

const defaultCatalogue = file => /(?:^|\/)copy\.ts$|(?:^|\/)sharedCopy\.ts$|^copy\/.*\.ts$/.test(file);

const production = file => /\.tsx?$/.test(file) && !/(\.test\.|Fixture|Browser|Harness|^testing\/|^perf\/|\.d\.ts$)/.test(file);

const unwrap = node => node?.type === 'TSAsExpression' || node?.type === 'TSSatisfiesExpression' ? unwrap(node.expression) : node;

const keyOf = node => node?.type === 'Identifier' ? node.name : node?.value;

const hash = text => createHash('sha256').update(text).digest('hex');

const slot = index => `⟦${index}⟧`;

const product = (left, right, merge) => left.flatMap(a => right.map(b => merge(a, b)));

// Ordered row titles longer than three words, each named exactly (U5205).
const LONG_LABELS = new Set(['Quick add from any app']);

// SK10 orders this label word for word; it is the one text allowed the Avoid word "session".
const ORDERED_LABELS = new Set(['Teach other Claude Code sessions about roundup']);

// Babel owns syntax and lexical binding resolution. This layer describes only copy policy.

export function checkCopy(files, { glossary = '', baseline = [], previous = baseline, root = '/__copy__', rules = null, catalogues = Object.keys(files).filter(defaultCatalogue) } = {}) {
  const catalogue = file => catalogues.includes(file);
  const modules = new Map();
  const keyTypes = copyKeyTypes(files, root);
  const programs = new WeakMap();
  const diagnostics = [];
  const reported = new Set();
  const occurrences = new Map();
  const used = new Set();

  const report = (rule, file, identity, text = '', branch = '') => {
    const row = { rule, identity, branch: String(branch), fingerprint: hash(text) };
    const key = JSON.stringify([file, ...Object.values(row)]);

    if (reported.has(key)) return;
    reported.add(key);
    const signature = JSON.stringify(row);
    const occurrence = (occurrences.get(signature) ?? 0) + 1;
    occurrences.set(signature, occurrence);

    if (occurrence > 1) row.identity += `#${occurrence}`;
    diagnostics.push({ ...row, file, text, message: `${file}: ${identity}${branch ? ` [${branch}]` : ''}: ${rule}${text ? `: ${text}` : ''}` });
  };

  for (const [file, source] of Object.entries(files)) {
    if (!production(file) && !catalogue(file)) continue;
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const paths = new WeakMap();
    const exports = new Map();
    traverse(ast, { enter(path) { paths.set(path.node, path); }, ExportNamedDeclaration(path) {
      const declaration = path.node.declaration;

      if (declaration?.type === 'FunctionDeclaration') exports.set(declaration.id.name, declaration);

      if (declaration?.type === 'VariableDeclaration') for (const item of declaration.declarations) exports.set(item.id.name, item.init);
    } });
    const module = { file, source, ast, paths, exports };
    modules.set(file, module);
    programs.set(ast.program, module);
  }

  const resolve = (file, path) => {
    const base = posix.normalize(posix.join(posix.dirname(file), path));

    return [base, base + '.ts', base + '.tsx', base + '/index.ts'].find(candidate => modules.has(candidate));
  };

  const binding = (module, node) => module.paths.get(node)?.scope.getBinding(node.name);

  const imported = (module, bound) => {
    if (bound?.path.type !== 'ImportSpecifier') return null;
    const file = resolve(module.file, bound.path.parent.source.value);

    return file ? { module: modules.get(file), name: bound.path.node.imported.name } : null;
  };

  const entries = new Map();

  const entryMaps = new Map();

  const collect = (module, name, seen = new Set()) => {
    const exportId = `${module.file}:${name}`;

    if (entryMaps.has(exportId)) return entryMaps.get(exportId);

    if (seen.has(exportId)) throw Error(`cyclic catalogue ${exportId}`);
    const next = new Set([...seen, exportId]);
    const result = new Map();
    const object = unwrap(module.exports.get(name));

    if (object?.type !== 'ObjectExpression') {
      report('unanalysable-catalogue', module.file, name);

      return result;
    }

    for (const property of object.properties) {
      if (property.type === 'SpreadElement' && property.argument.type === 'Identifier') {
        const bound = binding(module, property.argument);
        const imp = imported(module, bound);

        if (imp) for (const [key, id] of collect(imp.module, imp.name, next)) result.set(key, id);
        else {
          const local = bound?.path.node.init;

          if (local) {
            module.exports.set(property.argument.name, local);

            for (const [key, id] of collect(module, property.argument.name, next)) result.set(key, id);
          } else report('unanalysable-catalogue', module.file, name);
        }

        continue;
      }

      if (property.type !== 'ObjectProperty' || property.computed) {
        report('unanalysable-catalogue', module.file, name);
        continue;
      }

      const key = keyOf(property.key);
      const id = `${module.file}:${key}`;
      result.set(key, id);
      entries.set(id, { module, key, node: property.value, prose: property.leadingComments?.some(c => /@prose\b/.test(c.value)) });
    }

    entryMaps.set(exportId, result);

    return result;
  };

  for (const module of modules.values()) if (catalogue(module.file)) {
    for (const name of module.exports.keys()) if (name === 'copy' || name.endsWith('Copy')) collect(module, name);
  }

  const entryId = (module, name, key) => entryMaps.get(`${module.file}:${name}`)?.get(key) ?? `${module.file}:${key}`;

  // Resolve reads via Babel bindings, including aliases and destructuring. Tests never seed reachability.
  const selections = new Map();
  const labels = new Set();

  const read = (module, parts, label = false) => {
    const [key, ...rest] = parts;
    const id = entryId(module, 'copy', key);
    used.add(id);

    if (label) labels.add(id);

    if (!selections.has(id)) selections.set(id, new Set());
    selections.get(id).add(rest.join("."));
  };

  const follow = (bound, module, prefix = [], seen = new Set(), exportName = 'copy') => {
    if (!bound || seen.has(bound)) return;
    seen.add(bound);

    const readExport = (parts, label = false) => {
      const id = entryId(module, exportName, parts[0]);
      const entry = entries.get(id);

      if (entry) read(entry.module, [entry.key, ...parts.slice(1)], label);
      else report('missing-copy', module.file, parts.join('.'));
    };

    for (const path of bound.referencePaths) {
      let current = path;
      const parts = [...prefix];
      let computed = false;
      const attribute = path.findParent(parent => parent.isJSXAttribute());
      const label = attribute ? attribute.node.name.name === 'aria-label' : Boolean(path.findParent(parent => parent.isJSXElement() && parent.node.openingElement.name.type === 'JSXIdentifier' && ['button', 'label', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(parent.node.openingElement.name.name)));


      while (current.parentPath?.isMemberExpression() && current.parentPath.node.object === current.node) {
        const member = current.parentPath.node;
        const key = member.computed ? member.property.type === 'StringLiteral' ? member.property.value : null : member.property.name;

        if (key === null) {
          const caller = programs.get(path.findParent(parent => parent.isProgram()).node);
          const keys = rules && !rules.includes("dynamic-copy-read") ? null : keyTypes(caller.file, member.property.start, member.property.end);

          if (!keys && (!rules || rules.includes('dynamic-copy-read'))) report('dynamic-copy-read', caller.file, bound.identifier.name);

          if (!keys && rules) { parts.push('*'); break; }

          if (keys) for (const key of keys) readExport([...parts, key], label);
          computed = true;
          break;
        }

        parts.push(key);
        current = current.parentPath;
      }


      if (parts.at(-1) === 'get' && current.parentPath?.isCallExpression()) {
        parts.pop();
        const argument = current.parentPath.node.arguments[0];
        const caller = programs.get(path.findParent(parent => parent.isProgram()).node);

        const keys = argument?.type === 'StringLiteral' || argument?.type === 'NumericLiteral' ? [String(argument.value)]
          : argument ? keyTypes(caller.file, argument.start, argument.end) : null;

        if (!keys) {
          const entry = entries.get(entryId(module, exportName, parts[0]));
          const text = `${argument ? caller.source.slice(argument.start, argument.end) : ''}\n${entry ? entry.module.source.slice(entry.node.start, entry.node.end) : ''}`;
          report('dynamic-copy-read', caller.file, `${caller.file}:${parts.join('.')}`, text, '0');
          readExport([...parts, '*'], label);
        } else for (const key of keys) readExport([...parts, key], label);
        continue;
      }

      if (computed) continue;

      if (current.parentPath?.isVariableDeclarator()) {
        const id = current.parentPath.node.id;

        if (id.type === 'Identifier') follow(current.scope.getBinding(id.name), module, parts, new Set(seen), exportName);
        else if (id.type === 'ObjectPattern') for (const property of id.properties) {
          if (property.type !== 'ObjectProperty' || property.computed || property.value.type !== 'Identifier') report('dynamic-copy-read', module.file, bound.identifier.name);
          else readExport([...parts, keyOf(property.key)], label);
        }

        continue;
      }

      if (parts.length) readExport(parts, label);
      else report('dynamic-copy-read', module.file, bound.identifier.name);
    }
  };

  for (const module of modules.values()) {
    if (catalogue(module.file)) continue;
    traverse(module.ast, { ImportDeclaration(path) {
      const file = resolve(module.file, path.node.source.value);

      if (!file || !catalogue(file)) return;



      for (const specifier of path.node.specifiers) {
        if (specifier.type !== 'ImportSpecifier') { report('copy-import', module.file, path.node.source.value); continue; }

        if (!entryMaps.has(`${file}:${specifier.imported.name}`)) continue;

        follow(path.scope.getBinding(specifier.local.name), modules.get(file), [], new Set(), specifier.imported.name);
      }
    } });
  }

  const evaluating = new Set();
  const origins = new Map();
  const literals = new Map();

  // Moving a definition must not change which duplicate owns its exact exemption.
  const duplicateRank = (identity, text, branch) => {
    const index = previous.findIndex(row => row.rule === 'duplicate-copy' && row.identity === identity && row.fingerprint === hash(text) && row.branch === String(branch));

    return index < 0 ? -1 : index;
  };

  const remember = (text, module, node) => {
    const id = [...evaluating].at(-1);

    if (node.type === 'StringLiteral' && text.trim()) {
      const origin = `${module.file}:${node.start}`;

      if (!literals.has(text)) literals.set(text, new Map());
      const literal = literals.get(text).get(origin) ?? { identities: new Map() };
      literal.identities.set(entries.get(id)?.key ?? id, entries.get(id)?.module ?? module);
      literals.get(text).set(origin, literal);
    }

    if (!origins.has(id)) origins.set(id, new Map());

    if (!origins.get(id).has(text)) origins.get(id).set(text, new Set());
    origins.get(id).get(text).add(`${module.file}:${node.start}`);

    return text;
  };

  const evaluate = (module, input, env = new Map(), trail = []) => {
    const node = unwrap(input);

    if (!node) return [slot('value')];

    if (trail.includes(node)) return [slot('recursive')];
    const next = [...trail, node];
    const ev = child => evaluate(module, child, env, next);

    if (node.type === 'StringLiteral') return [remember(node.value, module, node)];

    if (node.type === 'NumericLiteral') return [String(node.value)];

    if (node.type === 'BooleanLiteral' || node.type === 'NullLiteral' || node.type === 'BinaryExpression' || node.type === 'UnaryExpression') return [slot('value')];

    if (node.type === 'Identifier') {
      if (env.has(node.name)) return env.get(node.name);
      const bound = binding(module, node);
      const imp = imported(module, bound);

      if (imp) return evaluate(imp.module, imp.module.exports.get(imp.name), env, next);

      return ev(bound?.path.node.init);
    }

    if (node.type === 'TemplateLiteral') {
      let values = [''];

      for (let i = 0; i < node.quasis.length; i++) {
        values = values.map(text => text + (node.quasis[i].value.cooked ?? ''));

        if (node.expressions[i]) values = product(values, ev(node.expressions[i]), (a, b) => a + b);

        if (values.length > 4096) throw Error('too many formatter branches');
      }

      return values.map(text => remember(text, module, node));
    }

    if (node.type === 'ConditionalExpression') return [...ev(node.consequent), ...ev(node.alternate)];

    if (node.type === 'LogicalExpression') return [...ev(node.left), ...ev(node.right)];

    if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') {
      const params = new Map(env);
      node.params.forEach((param, index) => { const name = param.type === 'AssignmentPattern' ? param.left.name : param.type === 'RestElement' ? param.argument.name : param.name;

        if (!params.has(name)) params.set(name, [slot(index)]); });

      if (node.body.type !== 'BlockStatement') return evaluate(module, node.body, params, next);
      const returns = [];

      const visit = statement => {
        if (statement.type === 'ReturnStatement') returns.push(...evaluate(module, statement.argument, params, next));
        else if (statement.type === 'BlockStatement') statement.body.forEach(visit);
        else if (statement.type === 'IfStatement') { visit(statement.consequent);

          if (statement.alternate) visit(statement.alternate); }
      };

      node.body.body.forEach(visit);

      return returns;
    }

    if (node.type === 'ObjectExpression') {
      const id = [...evaluating].at(-1);
      const selected = selections.get(id);
      const root = unwrap(entries.get(id)?.node) === node;

      return node.properties.flatMap(property => {
        if (property.type !== 'ObjectProperty') return [];
        const key = keyOf(property.key);

        if (root && selected?.size && ![...selected].some(path => path === '' || path === '*' || path.split('.')[0] === key)) {
          report('unused-copy', module.file, `${entries.get(id).key}.${key}`, module.source.slice(property.value.start, property.value.end), '0');

          return [];
        }

        return ev(property.value);
      });
    }

    if (node.type === 'ArrayExpression') return node.elements.flatMap(ev);

    if (node.type === 'MemberExpression') {
      const bound = node.object.type === 'Identifier' ? binding(module, node.object) : null;
      const imp = imported(module, bound);
      const key = node.computed ? ['StringLiteral', 'NumericLiteral'].includes(node.property.type) ? node.property.value : null : node.property.name;

      if (!imp && bound?.identifier.name === 'copy' && key !== null) return entryValues(entryId(module, 'copy', key));

      if (imp && entryMaps.has(`${imp.module.file}:${imp.name}`) && key !== null) return entryValues(entryId(imp.module, imp.name, key));

      if (node.object.type === 'MemberExpression' && node.object.object.type === 'Identifier') {
        const outer = imported(module, binding(module, node.object.object));

        if (outer?.name === 'copy') {
          const outerKey = node.object.computed ? node.object.property.value : node.object.property.name;
          const entry = entries.get(`${outer.module.file}:${outerKey}`);
          const object = unwrap(entry?.node);

          if (object?.type === 'ObjectExpression') {
            used.add(`${outer.module.file}:${outerKey}`);

            return object.properties.flatMap(property => property.type === 'ObjectProperty' && (key === null || keyOf(property.key) === key) ? evaluate(outer.module, property.value, env, next) : []);
          }
        }
      }

      let object = unwrap(node.object.type === 'Identifier' ? bound?.path.node.init : node.object);

      if (object?.type === 'ConditionalExpression') return [object.consequent, object.alternate].flatMap(branch => ev({ ...node, object: branch }));

      if (object?.type === 'ArrayExpression' && node.computed && node.property.type === 'NumericLiteral') return ev(object.elements[node.property.value]);

      if (object?.type === 'CallExpression' && object.callee.type === 'MemberExpression' && object.callee.property.name === 'find') {
        const source = object.callee.object;
        const list = source.type === 'Identifier' ? binding(module, source)?.path.node.init : source;

        if (list?.type === 'ArrayExpression') return list.elements.flatMap(row => ev({ ...node, object: row }));
      }

      if (object?.type === 'ObjectExpression') {
        const properties = object.properties.filter(p => p.type === 'ObjectProperty' && (key === null || keyOf(p.key) === key));

        return properties.flatMap(p => ev(p.value));
      }

      return [slot('value')];
    }

    if (node.type === 'CallExpression') {
      if (node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier') {
        const bound = binding(module, node.callee.object);
        const imp = imported(module, bound);
        const key = node.callee.computed ? node.callee.property.value : node.callee.property.name;
        const target = imp?.name === 'copy' ? imp.module : bound?.identifier.name === 'copy' ? module : null;
        const id = target ? entryId(target, imp?.name ?? 'copy', key) : null;
        const entry = entries.get(id);
        const fn = unwrap(entry?.node);

        if (fn?.type === 'ArrowFunctionExpression') {
          used.add(id);
          const params = new Map(env);
          fn.params.forEach((param, i) => params.set(param.type === 'AssignmentPattern' ? param.left.name : param.name, node.arguments[i] ? ev(node.arguments[i]) : [slot(i)]));

          return evaluate(target, fn, params, next);
        }
      }

      if (node.callee.type === 'Identifier') {
        const bound = binding(module, node.callee);
        const imp = imported(module, bound);
        const fn = unwrap(imp ? imp.module.exports.get(imp.name) : bound?.path.node.init ?? (bound?.path.isFunctionDeclaration() ? bound.path.node : null));

        if (fn?.type === 'ArrowFunctionExpression' || fn?.type === 'FunctionExpression' || fn?.type === 'FunctionDeclaration') {
          const params = new Map(env);
          fn.params.forEach((param, i) => { const name = param.type === 'AssignmentPattern' ? param.left.name : param.name; params.set(name, node.arguments[i] ? ev(node.arguments[i]) : [slot(i)]); });

          return evaluate(imp?.module ?? module, fn, params, next);
        }
      }

      if (node.callee.type === 'MemberExpression') {
        const method = keyOf(node.callee.property);

        if (method === 'toLowerCase') return ev(node.callee.object).map(value => value.toLowerCase());

        if (['trim', 'trimStart', 'trimEnd', 'toUpperCase'].includes(method)) return ev(node.callee.object).map(value => value[method]());

        if (method === 'get') {
          const bound = node.callee.object.type === 'Identifier' ? binding(module, node.callee.object) : null;
          const imp = imported(module, bound);
          const map = imp ? imp.module.exports.get(imp.name) : bound?.path.node.init;
          const mapValue = child => evaluate(imp?.module ?? module, child, env, next);
          const argument = node.arguments[0];
          const keys = argument?.type === 'StringLiteral' ? [argument.value] : argument?.type === 'Identifier' ? env.get(argument.name) : null;
          const known = keys?.every(key => !key.includes('⟦'));

          if (map?.type === 'NewExpression' && map.callee.name === 'Map') {
            const values = map.arguments[0];

            if (values?.type === 'ArrayExpression') return values.elements.flatMap(row => row?.type === 'ArrayExpression' && (!known || keys.includes(row.elements[0]?.value)) ? mapValue(row.elements[1]) : []);

            if (values?.type === 'CallExpression' && values.arguments[0]?.type === 'ObjectExpression') return values.arguments[0].properties.flatMap(property => property.type === 'ObjectProperty' && (!known || keys.includes(keyOf(property.key))) ? mapValue(property.value) : []);
          }
        }

        if (method === 'has') return [];

        if (node.callee.object.type === 'MemberExpression') return ev(node.callee.object);
      }

      if (node.callee.type === 'Identifier' && !['String', 'Number', 'Boolean'].includes(node.callee.name)) throw Error(`unanalysable call ${node.callee.name}`);

      return [slot('value')];
    }

    if (node.type === 'NewExpression' && node.callee.name === 'Map') {
      const rows = node.arguments[0];

      if (rows?.type !== 'ArrayExpression') return [slot('value')];
      const id = [...evaluating].at(-1);
      const selected = selections.get(id);
      const root = unwrap(entries.get(id)?.node) === node;

      return rows.elements.flatMap(row => {
        if (row?.type !== 'ArrayExpression') return [];
        const key = String(row.elements[0]?.value);

        if (root && selected?.size && ![...selected].some(path => path === '' || path === '*' || path === key)) {
          const value = row.elements[1];
          report('unused-copy', module.file, `${entries.get(id).key}.${key}`, module.source.slice(value.start, value.end), '0');

          return [];
        }

        return ev(row.elements[1]);
      });
    }

    throw Error(`unanalysable ${node.type}`);
  };

  const cached = new Map();

  const entryValues = id => {
    used.add(id);
    const parent = [...evaluating].at(-1);

    const inherit = values => {
      if (parent) {
        if (!origins.has(parent)) origins.set(parent, new Map());

        for (const text of values) {
          if (!origins.get(parent).has(text)) origins.get(parent).set(text, new Set());

          for (const origin of origins.get(id)?.get(text) ?? []) origins.get(parent).get(text).add(origin);
        }
      }

      return values;
    };

    if (cached.has(id)) return inherit(cached.get(id));

    if (evaluating.has(id)) throw Error('cyclic copy reference');
    const entry = entries.get(id);

    if (!entry) throw Error(`missing copy key ${id}`);
    evaluating.add(id);
    let values;

    try { values = evaluate(entry.module, entry.node); } finally { evaluating.delete(id); }

    cached.set(id, values);

    return inherit(values);
  };

  // Evaluate only reachable roots; unused entries cannot keep a dependency alive.
  for (const id of [...used]) {
    try { entryValues(id); } catch (error) { report('unanalysable-copy', entries.get(id)?.module.file ?? '', id, error.message); }
  }

  for (const [text, origins] of literals) {
    const branch = `literal:${hash(text).slice(0, 12)}`;

    const values = [...origins.values()].sort((a, b) =>
      Math.max(...[...a.identities.keys()].map(identity => duplicateRank(identity, text, branch))) - Math.max(...[...b.identities.keys()].map(identity => duplicateRank(identity, text, branch))));

    for (const { identities } of values.slice(1)) for (const [identity, module] of identities) report('duplicate-copy', module.file, identity, text, branch);
  }

  const banned = avoidedWords(glossary);
  const authored = new Map();

  for (const [id, entry] of entries) {
    const node = unwrap(entry.node);
    const reference = node.type === 'MemberExpression' && node.object.type === 'Identifier' ? imported(entry.module, binding(entry.module, node.object)) : null;

    // Forwarding a shared entry introduces neither a definition nor an unused key.
    if (reference && entryMaps.has(`${reference.module.file}:${reference.name}`)) continue;

    if (!used.has(id)) { report('unused-copy', entry.module.file, entry.key, entry.module.source.slice(entry.node.start, entry.node.end), '0'); continue; }

    const values = [...new Set(cached.get(id) ?? [])];
    const kind = !labels.has(id) && (entry.prose || values.some(text => /[.!?](?:\s|$)/.test(text))) ? 'prose' : 'label';

    for (const [branch, text] of values.entries()) {
      if (!text.trim() && entry.prose) report('unanalysable-prose', entry.module.file, entry.key, text, branch);

      if (!text.replace(/⟦[^⟧]*⟧/g, '').trim()) continue;

      if (!authored.has(text)) authored.set(text, []);
      authored.get(text).push({ id, entry, branch });

      for (const rule of (text.startsWith('roundup://') || /^⟦[^⟧]*⟧\nrup link read ⟦[^⟧]*⟧$/.test(text) ? [] : languageProblems(text, kind, banned).filter(rule => !(rule === 'label-length' && LONG_LABELS.has(text)) && !ORDERED_LABELS.has(text)))) report(rule, entry.module.file, entry.key, text, branch);
    }
  }

  for (const [text, values] of authored) {
    values.sort((a, b) => duplicateRank(a.entry.key, text, a.branch) - duplicateRank(b.entry.key, text, b.branch));
    let first;

    for (const { id, entry, branch } of values) {
      if (first && ![...(origins.get(id)?.get(text) ?? [])].some(origin => origins.get(first)?.get(text)?.has(origin))) report('duplicate-copy', entry.module.file, entry.key, text, branch);
      else first = id;
    }
  }

  return { inventory: inventory(diagnostics), diagnostics: applyBaseline(diagnostics, baseline, previous).filter(row => !rules || rules.includes(row.rule)) };
}

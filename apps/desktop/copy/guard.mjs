import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { avoidedWords, languageProblems } from './grammar.mjs';
import { copyKeyTypes } from './types.mjs';
import { inventory, applyBaseline } from './baseline.mjs';

const traverse = traverseModule.default ?? traverseModule;

const isCatalogue = file => /(?:^|\/)copy\.ts$|(?:^|\/)sharedCopy\.ts$|^copy\/.*\.ts$/.test(file);

const production = file => /\.tsx?$/.test(file) && !/(\.test\.|Fixture|Browser|Harness|^testing\/|^perf\/|\.d\.ts$)/.test(file);

const owner = file => file.includes('/') ? file.split('/')[0] : 'app';

const unwrap = node => node?.type === 'TSAsExpression' || node?.type === 'TSSatisfiesExpression' ? unwrap(node.expression) : node;

const keyOf = node => node?.type === 'Identifier' ? node.name : node?.value;

const hash = text => createHash('sha256').update(text).digest('hex');

const slot = index => `⟦${index}⟧`;

const product = (left, right, merge) => left.flatMap(a => right.map(b => merge(a, b)));

// Babel owns syntax and lexical binding resolution. This layer describes only copy policy.
export function checkCopy(files, { glossary = '', baseline = [], previous = baseline, root = '/__copy__', catalogues = Object.keys(files).filter(isCatalogue) } = {}) {
  const catalogue = file => catalogues.includes(file);
  const modules = new Map();
  const keyTypes = copyKeyTypes(files, root);
  const programs = new WeakMap();
  const diagnostics = [];
  const definitions = new Map();
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

  for (const module of modules.values()) {
    if (!catalogue(module.file)) continue;

    if (module.source.split('\n').length - Number(module.source.endsWith('\n')) > 1000) report('module-size', module.file, 'copy');
    const exported = [...module.exports].find(([name, value]) => (name === 'copy' || name.endsWith('Copy')) && unwrap(value)?.type === 'ObjectExpression');
    const object = unwrap(exported?.[1]);
    module.copyExport = exported?.[0];

    if (object?.type !== 'ObjectExpression') { report('unanalysable-catalogue', module.file, 'copy'); continue; }

    const properties = (source, object, seen = new Set()) => object.properties.flatMap(property => {
      if (property.type !== 'SpreadElement') return [{ source, property }];
      const node = unwrap(property.argument);
      const bound = node.type === 'Identifier' ? binding(source, node) : null;
      const imp = imported(source, bound);
      const target = imp?.module ?? source;
      const value = unwrap(imp ? target.exports.get(imp.name) : bound?.path.node.init);

      if (value?.type !== 'ObjectExpression' || seen.has(value)) {
        report('unanalysable-catalogue', source.file, 'spread');

        return [];
      }

      return properties(target, value, new Set([...seen, value]));
    });

    for (const {source, property} of properties(module, object)) {
      if (property.type !== 'ObjectProperty' || property.computed) { report('unanalysable-catalogue', module.file, 'copy'); continue; }

      const key = keyOf(property.key);
      entries.set(`${module.file}:${key}`, { module: source, key, node: property.value, prose: property.leadingComments?.some(c => /@prose\b/.test(c.value)) });
    }

    for (const node of module.ast.program.body) {
      if (node.type !== 'ImportDeclaration' || node.importKind === 'type') continue;
      const target = resolve(module.file, node.source.value);


      if (!target) report('copy-dependency', module.file, node.source.value);
    }
  }

  // Resolve reads via Babel bindings, including aliases and destructuring. Tests never seed reachability.
  const consumers = new Map();
  const selections = new Map();
  const labels = new Set();

  const read = (module, parts, surface, label = false) => {
    const [key, ...rest] = parts;
    const id = `${module.file}:${key}`;
    used.add(id);

    if (label) labels.add(id);

    if (!consumers.has(id)) consumers.set(id, new Set());
    consumers.get(id).add(surface);

    if (!selections.has(id)) selections.set(id, new Set());
    selections.get(id).add(rest.join("."));
  };

  const follow = (bound, module, surface, prefix = [], seen = new Set()) => {
    if (!bound || seen.has(bound)) return;
    seen.add(bound);

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
          const keys = keyTypes(caller.file, member.property.start, member.property.end);

          if (!keys) report('dynamic-copy-read', caller.file, bound.identifier.name);

          if (keys) for (const key of keys) read(module, [...parts, key], surface, label);
          computed = true;
          break;
        }

        parts.push(key);
        current = current.parentPath;
      }

      if (computed) continue;

      if (current.parentPath?.isVariableDeclarator()) {
        const id = current.parentPath.node.id;

        if (id.type === 'Identifier') follow(current.scope.getBinding(id.name), module, surface, parts, new Set(seen));
        else if (id.type === 'ObjectPattern') for (const property of id.properties) {
          if (property.type !== 'ObjectProperty' || property.computed || property.value.type !== 'Identifier') report('dynamic-copy-read', module.file, bound.identifier.name);
          else read(module, [...parts, keyOf(property.key)], surface, label);
        }

        continue;
      }

      if (parts.length) read(module, parts, surface, label);
      else report('dynamic-copy-read', module.file, bound.identifier.name);
    }
  };

  for (const module of modules.values()) {
    if (catalogue(module.file)) continue;
    traverse(module.ast, { ImportDeclaration(path) {
      const file = resolve(module.file, path.node.source.value);

      if (!file || !catalogue(file)) return;


      for (const specifier of path.node.specifiers) {
        if (specifier.type !== 'ImportSpecifier' || specifier.imported.name !== modules.get(file).copyExport) continue;

        follow(path.scope.getBinding(specifier.local.name), modules.get(file), owner(module.file));
      }
    } });
  }

  const evaluating = new Set();
  const dependencies = new Map();
  const origins = new Map();
  const literals = new Map();

  const remember = (text, module, node) => {
    const id = [...evaluating].at(-1);

    if (node.type === 'StringLiteral' && text.trim()) {
      const origin = `${module.file}:${node.start}`;
      const first = literals.get(text);

      if (first && first.origin !== origin) report('duplicate-copy', module.file, entries.get(id)?.key ?? id, text, `literal:${hash(text).slice(0, 12)}`);
      else literals.set(text, { origin });
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

        if (!params.has(name)) params.set(name, [slot(index)]);
      });

      if (node.body.type !== 'BlockStatement') return evaluate(module, node.body, params, next);
      const returns = [];

      const visit = statement => {
        if (statement.type === 'ReturnStatement') returns.push(...evaluate(module, statement.argument, params, next));
        else if (statement.type === 'BlockStatement') statement.body.forEach(visit);
        else if (statement.type === 'IfStatement') { visit(statement.consequent);

          if (statement.alternate) visit(statement.alternate);
        }
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
          report('unused-copy', module.file, `${entries.get(id).key}.${key}`, module.source.slice(property.value.start, property.value.end));

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

      if (!imp && bound?.identifier.name === 'copy' && key !== null) return entryValues(`${module.file}:${key}`);

      if (imp && imp.name === imp.module.copyExport && key !== null) return entryValues(`${imp.module.file}:${key}`);

      if (node.object.type === 'MemberExpression' && node.object.object.type === 'Identifier') {
        const outer = imported(module, binding(module, node.object.object));

        if (outer && outer.name === outer.module.copyExport) {
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
        const target = imp && imp.name === imp.module.copyExport ? imp.module : bound?.identifier.name === 'copy' ? module : null;
        const id = target ? `${target.file}:${key}` : null;
        const entry = entries.get(id);
        const fn = unwrap(entry?.node);

        if (fn?.type === 'ArrowFunctionExpression') {
          used.add(id);
          const parent = [...evaluating].at(-1);

          if (parent) {
            if (!dependencies.has(parent)) dependencies.set(parent, new Set());
            dependencies.get(parent).add(id);
          }

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
          const map = bound?.path.node.init;
          const argument = node.arguments[0];
          const keys = argument?.type === 'StringLiteral' ? [argument.value] : argument?.type === 'Identifier' ? env.get(argument.name) : null;
          const known = keys?.every(key => !key.includes('⟦'));

          if (map?.type === 'NewExpression' && map.callee.name === 'Map') {
            const values = map.arguments[0];

            if (values?.type === 'ArrayExpression') return values.elements.flatMap(row => row?.type === 'ArrayExpression' && (!known || keys.includes(row.elements[0]?.value)) ? ev(row.elements[1]) : []);

            if (values?.type === 'CallExpression' && values.arguments[0]?.type === 'ObjectExpression') return values.arguments[0].properties.flatMap(property => property.type === 'ObjectProperty' && (!known || keys.includes(keyOf(property.key))) ? ev(property.value) : []);
          }
        }

        if (method === 'has') return [];

        if (node.callee.object.type === 'MemberExpression') return ev(node.callee.object);
      }

      if (node.callee.type === 'Identifier' && !['String', 'Number', 'Boolean'].includes(node.callee.name)) throw Error(`unanalysable call ${node.callee.name}`);

      return [slot('value')];
    }

    if (node.type === 'NewExpression' && node.callee.name === 'Map') return node.arguments[0]?.type === 'ArrayExpression' ? node.arguments[0].elements.flatMap(row => row?.type === 'ArrayExpression' ? ev(row.elements[1]) : []) : [slot('value')];
    throw Error(`unanalysable ${node.type}`);
  };

  const cached = new Map();

  const entryValues = id => {
    used.add(id);
    const parent = [...evaluating].at(-1);

    if (parent && parent !== id) {
      if (!dependencies.has(parent)) dependencies.set(parent, new Set());
      dependencies.get(parent).add(id);
    }

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

    if (entry && !id.startsWith(entry.module.file + ':')) used.add(`${entry.module.file}:${entry.key}`);

    if (!entry) throw Error(`missing copy key ${id}`);
    evaluating.add(id);
    let values;

    try { values = evaluate(entry.module, entry.node); } finally { evaluating.delete(id); }

    cached.set(id, values);

    return inherit(values);
  };

  // Evaluate only reachable roots; unused entries cannot keep a dependency alive.
  for (const id of used) {
    try { entryValues(id); } catch (error) { report('unanalysable-copy', entries.get(id)?.module.file ?? '', id, error.message); }
  }

  const banned = avoidedWords(glossary);

  for (const [id, entry] of entries) {
    if (!used.has(id)) { report('unused-copy', entry.module.file, entry.key, entry.module.source.slice(entry.node.start, entry.node.end)); continue; }

    const node = unwrap(entry.node);

    // A direct shared reference is a consumer, not a second definition.
    if (node.type === 'MemberExpression' && imported(entry.module, node.object.type === 'Identifier' ? binding(entry.module, node.object) : null)?.module.copyExport) continue;
    const values = [...new Set(cached.get(id) ?? [])];
    const kind = entry.prose && !labels.has(id) ? 'prose' : 'label';

    for (const [branch, text] of values.entries()) {
      if (!text.trim() && entry.prose) report('unanalysable-prose', entry.module.file, entry.key, text, branch);

      if (!text.replace(/⟦[^⟧]*⟧/g, '').trim()) continue;
      const signature = text;
      const existing = definitions.get(signature);

      if (existing && existing !== id && ![...(origins.get(id)?.get(text) ?? [])].some(origin => origins.get(existing)?.get(text)?.has(origin))) report('duplicate-copy', entry.module.file, entry.key, text, branch);
      else definitions.set(signature, id);

      for (const rule of (text.startsWith('roundup://') || /^⟦[^⟧]*⟧\nrup link read ⟦[^⟧]*⟧$/.test(text) ? [] : languageProblems(text, kind, banned))) report(rule, entry.module.file, entry.key, text, branch);
    }
  }

  const propagate = (id, surfaces, seen = new Set()) => {
    if (seen.has(id)) return;
    seen.add(id);

    if (!consumers.has(id)) consumers.set(id, new Set());

    for (const surface of surfaces) consumers.get(id).add(surface);

    for (const dependency of dependencies.get(id) ?? []) propagate(dependency, surfaces, seen);
  };

  for (const [id, surfaces] of consumers) propagate(id, surfaces);
  const originSurfaces = new Map();

  for (const [id, values] of origins) for (const sources of values.values()) for (const origin of sources) {
    if (!originSurfaces.has(origin)) originSurfaces.set(origin, new Set());

    for (const surface of consumers.get(id) ?? []) originSurfaces.get(origin).add(surface);
  }

  for (const [id, values] of origins) if (consumers.has(id)) for (const sources of values.values()) for (const origin of sources) for (const surface of originSurfaces.get(origin) ?? []) consumers.get(id).add(surface);

  for (const [id, surfaces] of consumers) if (id.startsWith('sharedCopy.ts:') && surfaces.size < 2) report('shared-single-consumer', 'sharedCopy.ts', id.split(':')[1]);

  return { inventory: inventory(diagnostics), diagnostics: applyBaseline(diagnostics, baseline, previous) };
}

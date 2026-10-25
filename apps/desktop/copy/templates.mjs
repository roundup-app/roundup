const SLOT = '␟';

const value = (text, origin = null) => ({text, origin});

const cross = (left, right, origin) => left.flatMap(a => right.map(b => value(a.text + b.text, origin ?? a.origin ?? b.origin)));

const unwrapped = path => path?.isTSAsExpression() || path?.isTSSatisfiesExpression() ? unwrapped(path.get('expression')) : path;

/** Symbolic output: runtime values stay opaque; every authored result branch is read. */
export function templates(initial, lookup) {
  const read = (input, parameters = new Map(), stack = new Set()) => {
    const path = unwrapped(input);

    if (!path?.node || stack.has(path.node)) return [value(SLOT)];
    stack = new Set([...stack, path.node]);
    const again = child => read(child, parameters, stack);

    if (path.isStringLiteral()) return [value(path.node.value, path.node)];

    if (path.isNumericLiteral()) return [value(String(path.node.value), path.node)];

    if (path.isTemplateLiteral()) {
      let values = [value('')];
      const origin = path.node.quasis.some(part => /[a-zA-Z]/.test(part.value.cooked)) ? path.node : null;

      for (let index = 0; index < path.node.quasis.length; index++) {
        values = values.map(each => value(each.text + path.node.quasis[index].value.cooked, origin ?? each.origin));

        if (index < path.node.expressions.length) values = cross(values, again(path.get(`expressions.${index}`)), origin);
      }

      return values;
    }

    if (path.isConditionalExpression()) return [...again(path.get('consequent')), ...again(path.get('alternate'))];

    if (path.isLogicalExpression()) return [...again(path.get('left')), ...again(path.get('right'))];

    if (path.isBinaryExpression() && path.node.operator === '+') return cross(again(path.get('left')), again(path.get('right')), path.node);

    if (path.isArrowFunctionExpression() || path.isFunctionExpression()) {
      const names = new Map(parameters);

      for (const parameter of path.get('params')) {
        const name = parameter.isAssignmentPattern() ? parameter.node.left.name : parameter.isRestElement() ? parameter.node.argument.name : parameter.node.name;

        if (!names.has(name)) names.set(name, [value(SLOT)]);
      }

      return read(path.get('body'), names, stack);
    }

    if (path.isBlockStatement()) {
      const results = [];
      path.traverse({ ReturnStatement(at) { if (at.getFunctionParent()?.node === path.getFunctionParent()?.node) results.push(...again(at.get('argument'))); } });

      return results.length ? results : [value(SLOT)];
    }

    if (path.isObjectExpression()) return path.get('properties').flatMap(property => property.isObjectProperty() ? again(property.get('value')) : [value(SLOT)]);

    if (path.isIdentifier()) {
      if (parameters.has(path.node.name)) return parameters.get(path.node.name);
      const target = lookup(path);

      return target ? again(target) : [value(SLOT)];
    }

    if (path.isMemberExpression()) {
      const target = lookup(path);

      if (target && target.node !== path.node) return again(target);
      const object = unwrapped(path.get('object'));

      if (object.isObjectExpression()) {
        if (path.node.computed && path.node.property.type !== 'StringLiteral') return again(object);
        const name = path.node.property.name ?? path.node.property.value;
        const property = object.get('properties').find(each => (each.node.key.name ?? each.node.key.value) === name);

        return property ? again(property.get('value')) : [value(SLOT)];
      }

      return [value(SLOT)];
    }

    if (path.isCallExpression()) {
      const callee = path.get('callee');
      const target = lookup(callee);

      if (target?.isArrowFunctionExpression() || target?.isFunctionExpression()) {
        const names = new Map(parameters);

        for (const [index, param] of target.get('params').entries()) names.set(param.node.name, path.node.arguments[index] ? again(path.get(`arguments.${index}`)) : [value(SLOT)]);

        return read(target.get('body'), names, stack);
      }

      if (callee.isMemberExpression()) {
        const method = callee.node.property.name;
        const object = callee.get('object');

        if (method === 'get') {
          const map = lookup(object) ?? object;

          if (map.isNewExpression() && map.node.callee.name === 'Map') {
            const entries = map.get('arguments.0');

            if (entries.isArrayExpression()) return entries.get('elements').flatMap(entry => again(entry.get('elements.1')));

            if (entries.isCallExpression() && entries.node.callee.property?.name === 'entries') return again(entries.get('arguments.0'));
          }
        }

        if (method === 'toLowerCase') return again(object).map(each => value(each.text.toLowerCase(), each.origin));

        if (method === 'join' && object.isArrayExpression()) {
          const separator = path.node.arguments[0]?.type === 'StringLiteral' ? path.node.arguments[0].value : ',';

          return object.get('elements').reduce((result, each, index) => cross(result.map(item => value(item.text + (index ? separator : ''), item.origin)), again(each), path.node), [value('')]);
        }
      }

      return [value(SLOT)];
    }

    return [value(SLOT)];
  };

  return read(initial).filter((each, index, all) => all.findIndex(other => other.text === each.text && other.origin === each.origin) === index);
}

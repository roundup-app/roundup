import { relative } from "node:path";
import { defineRule } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";
import { unwrapArrayExpression } from "../shared/array-method.ts";

const limit = 60_000;

function unwrap(node) {
  return node ? unwrapArrayExpression(node) : node;
}

function initializer(source, node) {
  const binding = resolveVariable(source, node);
  if (!binding || binding.references.some(ref => ref.isWrite() && !ref.init)) return null;
  const def = binding.defs.find(def => def.type === "Variable" && def.node.parent.kind === "const");
  return def?.node.init ?? null;
}

function value(source, node, seen = new Set()) {
  node = unwrap(node);
  if (!node || seen.has(node)) return null;
  seen = new Set(seen).add(node);
  if (node.type === "Literal") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === "Identifier") return value(source, initializer(source, node), seen);
  if (node.type === "UnaryExpression") {
    const operand = value(source, node.argument, seen);
    if (typeof operand !== "number") return null;
    if (node.operator === "+") return operand;
    if (node.operator === "-") return -operand;
  }
  if (node.type === "BinaryExpression") {
    const left = value(source, node.left, seen);
    const right = value(source, node.right, seen);
    if (typeof left !== "number" || typeof right !== "number") return null;
    switch (node.operator) {
      case "+": return left + right;
      case "-": return left - right;
      case "*": return left * right;
      case "/": return left / right;
      case "%": return left % right;
      case "**": return left ** right;
    }
  }
  return null;
}

function member(node) {
  node = unwrap(node);
  if (node?.type !== "MemberExpression") return null;
  const name = node.computed ? node.property.value : node.property.name;
  return typeof name === "string" ? { name, object: node.object } : null;
}

function imported(source, node, seen = new Set()) {
  node = unwrap(node);
  if (!node || seen.has(node)) return null;
  seen = new Set(seen).add(node);
  const property = member(node);
  if (property && imported(source, property.object, seen) === "namespace") return property.name;
  if (node.type !== "Identifier") return null;
  const binding = resolveVariable(source, node);
  if (!binding) return ["it", "test", "describe", "suite", "vi"].includes(node.name) ? node.name : null;
  for (const def of binding.defs) {
    if (def.type !== "ImportBinding" || def.parent?.source.value !== "vitest") continue;
    if (def.node.type === "ImportNamespaceSpecifier") return "namespace";
    return def.node.imported?.name ?? def.node.imported?.value ?? null;
  }
  return imported(source, initializer(source, node), seen);
}

function registration(source, node, seen = new Set()) {
  node = unwrap(node);
  if (!node || seen.has(node)) return null;
  seen = new Set(seen).add(node);
  const name = imported(source, node);
  if (["it", "test"].includes(name)) return "test";
  if (["describe", "suite"].includes(name)) return "suite";
  if (node.type === "Identifier") return registration(source, initializer(source, node), seen);
  if (node.type === "MemberExpression") return registration(source, node.object, seen);
  if (node?.type === "CallExpression" || node?.type === "TaggedTemplateExpression") {
    const callee = node.callee ?? node.tag;
    const property = member(callee);
    if (property && ["each", "for", "skipIf", "runIf", "extend", "scoped"].includes(property.name)) return registration(source, property.object, seen);
  }
  return null;
}

function objectProperty(source, node, name, seen = new Set()) {
  node = unwrap(node);
  if (!node) return undefined;
  if (seen.has(node)) return node;
  seen = new Set(seen).add(node);
  if (node.type === "Identifier") {
    const init = initializer(source, node);
    return init ? objectProperty(source, init, name, seen) : node;
  }
  if (node.type !== "ObjectExpression") return node;
  let result;
  for (const property of node.properties) {
    if (property.type === "SpreadElement") {
      const spread = resolved(source, property.argument);
      result = spread?.type === "ObjectExpression" ? objectProperty(source, spread, name, seen) ?? result : property.argument;
    } else if ((property.computed ? value(source, property.key) : property.key.name ?? property.key.value) === name) {
      result = property.value;
    }
  }
  return result;
}

function resolved(source, node, seen = new Set()) {
  node = unwrap(node);
  if (!node || node.type !== "Identifier" || seen.has(node)) return node;
  seen = new Set(seen).add(node);
  return resolved(source, initializer(source, node), seen) ?? node;
}

function timeout(source, call) {
  const second = resolved(source, call.arguments[1]);
  const third = resolved(source, call.arguments[2]);
  if (second?.type === "ObjectExpression") return objectProperty(source, second, "timeout");
  if (third && !["ArrowFunctionExpression", "FunctionExpression"].includes(third.type)) return third;
  if (second && !["ArrowFunctionExpression", "FunctionExpression"].includes(second.type) && third) return second;
  return undefined;
}

function validException(entry) {
  return ["file", "test", "scenario", "observer", "reason"].every(key => typeof entry[key] === "string" && entry[key].trim()) && Number.isFinite(entry.maximum) && entry.maximum > limit;
}

function isConfig(source, call) {
  const method = member(call.callee);
  return method?.name === "setConfig" && imported(source, method.object) === "vi";
}

/** Opt-in until the exact existing-test exceptions have been justified. No file-wide exemption exists. */
export const boundedTestTimeoutRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Bound statically resolved Vitest timeouts and require justified exact-test exceptions." },
    schema: [{
      type: "object", additionalProperties: false,
      properties: { exceptions: { type: "array", items: { type: "object" } } },
    }],
    messages: {
      timeout: '{{test}}: timeout {{value}} ms exceeds its finite bound {{maximum}} ms (zero and unresolved values are forbidden).',
      exception: 'Invalid timeout exception: {{test}} needs an exact file/test, scenario, process/clock, reason and finite maximum.',
    },
  },
  create(context) {
    const source = context.sourceCode;
    const file = relative(context.cwd, context.filename).replaceAll("\\", "/");
    const exceptions = context.options[0]?.exceptions ?? [];
    const calls = [];
    const configs = [];
    const defaults = [];

    function check(node, title, maximum) {
      const actual = value(source, node);
      if (typeof actual !== "number" || !Number.isFinite(actual) || actual <= 0 || actual > maximum) {
        context.report({ node, messageId: "timeout", data: { test: title, value: actual === null ? "unresolved" : String(actual), maximum: String(maximum) } });
      }
    }

    return {
      CallExpression(node) {
        const kind = registration(source, node.callee);
        const method = member(node.callee);
        const builder = method && ["each", "for", "skipIf", "runIf", "extend", "scoped"].includes(method.name);
        if (kind && !builder && node.arguments.length >= 2) calls.push({ node, kind });
        if (isConfig(source, node)) {
          const configured = objectProperty(source, node.arguments[0], "testTimeout");
          if (configured) configs.push(configured);
        }
      },
      Property(node) {
        if ((node.key.name ?? node.key.value) !== "testTimeout") return;
        defaults.push(node.value);
      },
      "Program:exit"(program) {
        for (const entry of exceptions) {
          if (!validException(entry)) {
            context.report({ node: program, messageId: "exception", data: { test: String(entry.test) } });
          }
        }
        // A global over-limit default would authorize tests with no exact entry.
        for (const node of defaults) if (!configs.includes(node)) check(node, "configured default", limit);
        for (const call of calls) {
          if (call.kind !== "test") continue;
          const parents = calls.filter(parent => parent.kind === "suite" && parent.node.start < call.node.start && parent.node.end > call.node.end)
            .sort((a, b) => a.node.start - b.node.start);
          const names = [...parents, call].map(item => value(source, item.node.arguments[0]));
          const named = names.every(name => typeof name === "string");
          const title = named ? names.join(" > ") : "<dynamic test name>";
          const entry = named && exceptions.find(entry => entry.file === file && entry.test === title);
          const maximum = entry && validException(entry) ? entry.maximum : limit;
          const explicit = timeout(source, call.node);
          const inherited = parents.map(parent => timeout(source, parent.node)).filter(Boolean).at(-1);
          const nodes = explicit ? [explicit] : inherited ? [inherited] : configs;
          for (const node of nodes) check(node, title, maximum);
        }
      },
    };
  },
});

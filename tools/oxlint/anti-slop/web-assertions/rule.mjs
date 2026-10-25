import { createHash } from "node:crypto";
import { relative } from "node:path";
import { baselineEntries, assertionKey } from "./baseline.mjs";
import { browserEvidence, dimensions, geometry, text } from "./browser.mjs";
import { defineRule } from "@oxlint/plugins";
import { resolveVariable } from "../shared/scope.ts";
import { unwrapArrayExpression } from "../shared/array-method.ts";

const queries = /^(?:get|find|query)(?:All)?By(?:Text|Role|LabelText|PlaceholderText|Title|DisplayValue)$/;
const evaluations = new Set(["read", "evaluate", "eval", "call", "browser"]);
const equality = new Set(["toBe", "toEqual", "toStrictEqual", "toMatch", "toContain", "toContainEqual"]);
const existence = new Set(["toBeTruthy", "toBeDefined", "toBeNull", "toBeInTheDocument", "toHaveLength"]);

function children(node, keys) {
  return (keys[node.type] ?? []).flatMap(key => {
    const child = node[key];
    return Array.isArray(child) ? child.filter(Boolean) : child ? [child] : [];
  });
}

function member(node) {
  node = node && unwrapArrayExpression(node);
  if (!["MemberExpression", "OptionalMemberExpression"].includes(node?.type)) return null;
  return node.computed ? node.property.value : node.property.name;
}

function literal(node) {
  if (node?.type === "Literal") return node.value;
  if (node?.type === "TemplateLiteral" && !node.expressions.length) return node.quasis[0].value.cooked;
  return undefined;
}

function definitions(source, node) {
  const variable = resolveVariable(source, node);
  if (!variable) return [];
  return [...variable.defs.flatMap(def => {
    if (def.type === "Variable" && def.node.init) return [def.node.init];
    if (def.type === "FunctionName") return [def.node];
    return [];
  }), ...variable.references.filter(ref => ref.isWrite() && ref.writeExpr).map(ref => ref.writeExpr)];
}

function wording(source, node, seen = new Set()) {
  node = node && unwrapArrayExpression(node);
  if (!node || seen.has(node)) return false;
  seen.add(node);
  const value = literal(node);
  if (typeof value === "string") return value.length > 0;
  if (node.regex) return node.regex.pattern.startsWith("^") && node.regex.pattern.endsWith("$");
  if (node.type !== "Identifier") return false;
  const variable = resolveVariable(source, node);
  // A value delivered through an input/write action is user content, not pinned App copy.
  const supplied = variable?.references.some(ref => {
    for (let parent = ref.identifier.parent; parent && parent.type !== "Program"; parent = parent.parent) {
      if (parent.type === "CallExpression" && ["input", "change", "type", "fill", "write", "setValue", "paste", "rpc"].includes(member(parent.callee) ?? parent.callee.name)) return true;
      if (["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(parent.type)) break;
    }
    return false;
  });
  return !supplied && definitions(source, node).some(def => wording(source, def, seen));
}

function imported(source, node, name, seen = new Set()) {
  node = node && unwrapArrayExpression(node);
  if (!node || seen.has(node)) return false;
  seen.add(node);
  if (node.type === "MemberExpression") {
    if (member(node) === name && node.object.type === "Identifier") {
      const binding = resolveVariable(source, node.object);
      return binding?.defs.some(def => def.type === "ImportBinding" && def.node.type === "ImportNamespaceSpecifier" && def.parent?.source.value === "vitest") ?? false;
    }
    return imported(source, node.object, name, seen);
  }
  if (node.type === "CallExpression" || node.type === "TaggedTemplateExpression") return imported(source, node.callee ?? node.tag, name, seen);
  if (node.type !== "Identifier") return false;
  const binding = resolveVariable(source, node);
  if (!binding) return node.name === name;
  if (binding.defs.some(def => def.type === "ImportBinding" && def.parent?.source.value === "vitest" && (def.node.imported?.name ?? def.node.imported?.value) === name)) return true;
  return definitions(source, node).some(def => imported(source, def, name, seen));
}

function expectation(source, node) {
  node = node && unwrapArrayExpression(node);
  while (node?.type === "MemberExpression") node = node.object;
  if (node?.type !== "CallExpression") return null;
  if (imported(source, node.callee, "expect")) return node;
  return null;
}

function title(source, node) {
  const names = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type !== "CallExpression") continue;
    if (!["test", "it", "describe", "suite"].some(name => imported(source, parent.callee, name))) continue;
    const name = literal(parent.arguments[0]);
    names.unshift(typeof name === "string" ? name : source.getText(parent.arguments[0]));
  }
  if (names.length) return names.join(" > ");
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "FunctionDeclaration" && parent.id) return "<helper:" + parent.id.name + ">";
    if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") return "<helper:" + parent.id.name + ">";
  }
  return "<module>";
}

function assertionRule(enforce) {
return defineRule({
  meta: {
    type: "problem",
    docs: { description: "Inventory appearance assertions and literal DOM-copy candidates without executing tests." },
    schema: [],
    messages: { observation: "{{observation}}" },
  },
  create(context) {
    if (!/\.[cm]?[jt]sx?$/.test(context.filename)) return {};
    const source = context.sourceCode;
    const file = relative(context.cwd, context.filename).replaceAll("\\", "/");
    const remaining = new Map((enforce ? baselineEntries(context.cwd) : []).filter(entry => entry.file === file).map(entry => [assertionKey(entry), entry]));

    function evidence(root) {
      const found = new Set();
      const dependencies = new Set();
      const seen = new Set();
      function scan(node, keys, embedded = false) {
        if (!node || seen.has(node)) return;
        seen.add(node);
        if (["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(node.type)) {
          if (node.body.type !== "BlockStatement") scan(node.body, keys, embedded);
          else {
            function returns(part) {
              if (part.type === "ReturnStatement") scan(part.argument, keys, embedded);
              else if (!["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(part.type)) {
                for (const child of children(part, keys)) returns(child);
              }
            }
            returns(node.body);
          }
          return;
        }
        const name = member(node);
        if (geometry.has(name) || dimensions.test(name ?? "") || (node.type === "Identifier" && dimensions.test(node.name))) found.add("appearance");
        if (text.has(name)) found.add("dom-text");
        if (node.type === "CallExpression" && queries.test(member(node.callee) ?? "")) {
          const query = member(node.callee);
          const argument = query.endsWith("ByRole")
            ? node.arguments[1]?.properties?.find(property => (property.key.name ?? property.key.value) === "name")?.value
            : node.arguments[0];
          if (wording(source, argument)) found.add("text-query");
          scan(argument, keys, embedded);
          // A named ancestor locates the query's scope; it is not the asserted copy.
          return;
        }
        if (node.type === "CallExpression" && (node.callee.name === "getComputedStyle" || member(node.callee) === "getComputedStyle")) found.add("appearance");
        if (!embedded && node.type === "Identifier") {
          for (const def of definitions(source, node)) {
            if (!seen.has(def)) dependencies.add(source.getText(def));
            scan(def, source.visitorKeys);
          }
        }
        if (!embedded && node.type === "CallExpression" && evaluations.has(node.callee.name ?? member(node.callee))) {
          for (const arg of node.arguments) scanScript(arg);
        }
        for (const child of children(node, keys)) scan(child, keys, embedded);
      }
      function scanScript(node, visited = new Set()) {
        if (!node || visited.has(node)) return;
        visited.add(node);
        if (node.type === "Identifier") {
          for (const def of definitions(source, node)) scanScript(def, visited);
          return;
        }
        let script = literal(node);
        if (node.type === "TemplateLiteral") script = node.quasis.map(part => part.value.cooked).join("null");
        if (typeof script !== "string" || ["eval", "--json"].includes(script)) return;
        for (const kind of browserEvidence(script)) found.add(kind);
      }
      scan(root, source.visitorKeys);
      return { found, dependencies: [...dependencies].sort() };
    }

    return {
      "Program:exit"(node) {
        for (const entry of remaining.values()) context.report({ node, messageId: "observation", data: { observation: "Stale assertion baseline entry: " + assertionKey(entry) } });
      },
      CallExpression(node) {
        const matcher = member(node.callee);
        if (!matcher) return;
        const expect = expectation(source, unwrapArrayExpression(node.callee).object);
        if (!expect) return;
        const observed = evidence(expect.arguments[0]);
        const kinds = [];
        if (matcher === "toHaveStyle" || observed.found.has("appearance")) kinds.push("appearance");
        const expected = node.arguments[0];
        const hasWording = wording(source, expected);
        if (["toHaveTextContent", "toHaveAccessibleName"].includes(matcher) && hasWording) kinds.push("copy-candidate");
        else if (observed.found.has("dom-text") && equality.has(matcher) && hasWording) kinds.push("copy-candidate");
        else if (observed.found.has("text-query") && existence.has(matcher)) kinds.push("copy-candidate");
        if (observed.found.has("unparsed-browser-script")) kinds.push("unparsed-browser-script");
        if (matcher.includes("Snapshot")) kinds.push("snapshot-review");
        if (!kinds.length) return;
        const assertion = source.getText(node);
        const dependencies = [...new Set([...observed.dependencies, ...evidence(expected).dependencies])].sort();
        // Pin the enclosing function as well: duplicating, editing or moving an assertion
        // must never spend another assertion's permission, even for identical wording.
        let owner = node;
        for (let parent = node.parent; parent; parent = parent.parent) {
          owner = parent;
          if (parent.type === "CallExpression" && ["test", "it"].some(name => imported(source, parent.callee, name))) break;
          if (parent.type === "FunctionDeclaration" || parent.type === "VariableDeclarator" || parent.type === "Program") break;
        }
        const path = [];
        for (let child = node; child !== owner; child = child.parent) {
          const parent = child.parent;
          for (const key of source.visitorKeys[parent.type] ?? []) {
            if (parent[key] === child) path.unshift(key);
            else if (Array.isArray(parent[key]) && parent[key].includes(child)) path.unshift([key, parent[key].indexOf(child)]);
          }
        }
        const identity = createHash("sha256").update(JSON.stringify([assertion, dependencies, source.getText(owner), path])).digest("hex");
        const name = title(source, node);
        const key = assertionKey({ file, test: name, identity });
        if (enforce && remaining.delete(key)) return;
        context.report({ node, messageId: "observation", data: { observation: JSON.stringify({
          test: name, identity, kinds, assertion, dependencies,
        }) } });
      },
    };
  },
});
}

export const auditWebAssertionsRule = assertionRule(false);
export const noNewWebAssertionsRule = assertionRule(true);

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { defineRule } from "@oxlint/plugins";
import { resolveVariable } from "../shared/scope.ts";
import { unwrapArrayExpression } from "../shared/array-method.ts";

// Babel is already a desktop devDependency; Oxlint does not parse code inside strings.
const requireDesktop = createRequire(new URL("../../../../apps/desktop/package.json", import.meta.url));
const { parseExpression } = requireDesktop("@babel/parser");
const { VISITOR_KEYS } = requireDesktop("@babel/types");
const dimensions = /^(?:offset|client|scroll)(?:Width|Height|Top|Left)$|^(?:inner|outer)(?:Width|Height)$/;
const geometry = new Set(["getBoundingClientRect", "getClientRects"]);
const text = new Set(["textContent", "innerText", "innerHTML", "outerHTML"]);
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
  return variable.defs.flatMap(def => {
    if (def.type === "Variable" && def.node.init) return [def.node.init];
    if (def.type === "FunctionName") return [def.node];
    return [];
  });
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
    names.unshift(typeof name === "string" ? name : "<dynamic title>");
  }
  return names.join(" > ") || "<helper>";
}

/** Audit only: provenance candidates need review before becoming a shrinking baseline. */
export const auditWebAssertionsRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Inventory appearance assertions and literal DOM-copy candidates without executing tests." },
    schema: [],
    messages: { observation: "{{observation}}" },
  },
  create(context) {
    if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(context.filename)) return {};
    const source = context.sourceCode;

    function evidence(root) {
      const found = new Set();
      const dependencies = new Set();
      const seen = new Set();
      function scan(node, keys, embedded = false) {
        if (!node || seen.has(node)) return;
        seen.add(node);
        const name = member(node);
        if (geometry.has(name) || dimensions.test(name ?? "") || (node.type === "Identifier" && dimensions.test(node.name))) found.add("appearance");
        if (text.has(name)) found.add("dom-text");
        if (node.type === "CallExpression" && queries.test(member(node.callee) ?? "")) {
          const query = member(node.callee);
          const argument = query.endsWith("ByRole")
            ? node.arguments[1]?.properties?.find(property => (property.key.name ?? property.key.value) === "name")?.value
            : node.arguments[0];
          const wording = literal(argument);
          if (typeof wording === "string" && wording.length > 0 || argument?.regex?.pattern?.startsWith("^") && argument.regex.pattern.endsWith("$")) found.add("text-query");
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
        try {
          scan(parseExpression(script, { plugins: ["typescript", "jsx"] }), VISITOR_KEYS, true);
        } catch {
          // Dynamic fragments or non-expression scripts remain visible for manual review.
          found.add("unparsed-browser-script");
        }
      }
      scan(root, source.visitorKeys);
      return { found, dependencies: [...dependencies].sort() };
    }

    return {
      CallExpression(node) {
        const matcher = member(node.callee);
        if (!matcher) return;
        const expect = expectation(source, unwrapArrayExpression(node.callee).object);
        if (!expect) return;
        const observed = evidence(expect.arguments[0]);
        const kinds = [];
        if (matcher === "toHaveStyle" || observed.found.has("appearance")) kinds.push("appearance");
        const expected = node.arguments[0];
        const expectedText = literal(expected);
        const exactRegex = expected?.regex?.pattern?.startsWith("^") && expected.regex.pattern.endsWith("$");
        const hasWording = typeof expectedText === "string" && expectedText.length > 0 || exactRegex;
        if (["toHaveTextContent", "toHaveAccessibleName"].includes(matcher) && hasWording) kinds.push("copy-candidate");
        else if (observed.found.has("dom-text") && equality.has(matcher) && hasWording) kinds.push("copy-candidate");
        else if (observed.found.has("text-query") && existence.has(matcher)) kinds.push("copy-candidate");
        if (observed.found.has("unparsed-browser-script")) kinds.push("unparsed-browser-script");
        if (matcher.includes("Snapshot")) kinds.push("snapshot-review");
        if (!kinds.length) return;
        const assertion = source.getText(node);
        const identity = createHash("sha256").update(JSON.stringify([assertion, observed.dependencies])).digest("hex");
        context.report({ node, messageId: "observation", data: { observation: JSON.stringify({
          test: title(source, node), identity, kinds, assertion, dependencies: observed.dependencies,
        }) } });
      },
    };
  },
});

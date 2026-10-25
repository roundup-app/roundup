import { definePlugin } from "@oxlint/plugins";

function variable(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const binding = scope.set.get(identifier.name);
    if (binding) return binding;
    scope = scope.upper;
  }
  return null;
}

function vitestImport(sourceCode, identifier) {
  const binding = variable(sourceCode, identifier);
  if (!binding) return sourceCode.isGlobalReference(identifier) ? identifier.name : null;
  for (const definition of binding.defs) {
    if (definition.type !== "ImportBinding" || definition.parent?.source.value !== "vitest") continue;
    if (definition.node.type === "ImportNamespaceSpecifier") return "*";
    return definition.node.imported?.name ?? definition.node.imported?.value;
  }
  return null;
}

function testCallable(sourceCode, expression) {
  if (expression.type === "Identifier") {
    return ["it", "test"].includes(vitestImport(sourceCode, expression));
  }
  if (expression.type === "CallExpression") return testCallable(sourceCode, expression.callee);
  if (expression.type === "TaggedTemplateExpression") return testCallable(sourceCode, expression.tag);
  if (expression.type !== "MemberExpression") return false;
  if (expression.object.type === "Identifier" && vitestImport(sourceCode, expression.object) === "*") {
    return ["it", "test"].includes(expression.property.name ?? expression.property.value);
  }
  return testCallable(sourceCode, expression.object);
}

function literal(node) {
  if (node?.type === "Literal") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

// An opt-in inventory visitor, not a normal lint rule or an execution claim.
// Oxlint owns parsing, scopes, TS/TSX syntax and source locations.
export default definePlugin({
  meta: { name: "web-cost" },
  rules: {
    imports: {
      meta: { type: "problem", schema: [] },
      create(context) {
        const imports = [];
        const tests = [];
        function record(node, source, kind) {
          imports.push({ specifier: literal(source), expression: context.sourceCode.getText(source), kind, line: node.loc.start.line });
        }
        return {
          ImportDeclaration(node) {
            if (node.importKind === "type") return;
            if (node.specifiers.length && node.specifiers.every(specifier => specifier.importKind === "type")) return;
            record(node, node.source, "static");
          },
          ExportNamedDeclaration(node) {
            if (!node.source || node.exportKind === "type") return;
            if (node.specifiers.length && node.specifiers.every(specifier => specifier.exportKind === "type")) return;
            record(node, node.source, "export");
          },
          ExportAllDeclaration(node) {
            if (node.exportKind !== "type") record(node, node.source, "export");
          },
          ImportExpression(node) {
            record(node, node.source, "dynamic");
          },
          CallExpression(node) {
            if (node.callee.type === "Identifier" && node.callee.name === "require" && context.sourceCode.isGlobalReference(node.callee) && node.arguments[0]) {
              record(node, node.arguments[0], "require");
            }
            if (!testCallable(context.sourceCode, node.callee)) return;
            // each/skipIf/runIf's decorator calls are not test registrations.
            if (!node.arguments.some(argument => ["ArrowFunctionExpression", "FunctionExpression"].includes(argument.type))) return;
            const name = literal(node.arguments[0]);
            tests.push({ name: name ?? context.sourceCode.getText(node.arguments[0]), line: node.loc.start.line, literal: name !== null });
          },
          "Program:exit"(node) {
            context.report({ node, message: JSON.stringify({ imports, tests }) });
          },
        };
      },
    },
  },
});

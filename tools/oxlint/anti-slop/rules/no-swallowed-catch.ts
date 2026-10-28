import { defineRule } from "@oxlint/plugins";

/** U3791c: a production rejection must reach its owning recovery line. */
export const noSwallowedCatchRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Reject production catch callbacks that discard a rejection." },
    messages: { swallowed: "Report the rejected operation to its owning failure line." },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const file = context.filename.replaceAll("\\", "/");

        if (!file.includes("/apps/desktop/src/") || /\.test\.[^/]+$/.test(file)
          || file.includes("/src/testing/") || file.endsWith("/todos/laneBrowser.ts") || file.endsWith("/shelf/u371Browser.ts")) return;
        if (node.callee.type !== "MemberExpression" || node.callee.computed
          || node.callee.property.type !== "Identifier" || node.callee.property.name !== "catch") return;
        const handler = node.arguments[0];

        if (!handler) return;
        const logging = handler.type === "MemberExpression" && handler.object.type === "Identifier"
          && handler.object.name === "console" && handler.property.type === "Identifier" && handler.property.name === "warn";
        const discarded = handler.type === "ArrowFunctionExpression" && (
          (handler.body.type === "Identifier" && handler.body.name === "undefined")
          || (handler.body.type === "BlockStatement" && handler.body.body.length === 0)
        );

        if (logging || discarded) context.report({ node, messageId: "swallowed" });
      },
    };
  },
});

import { defineRule } from "@oxlint/plugins";

/** A component reads or focuses another component's element only through a ref or a name its owner provides (`provideFocusTarget`). */
export const noDocumentQueryRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Reject document.querySelector* in the App outside keys/focus.ts, testing/ and perf/." },
    messages: { query: "Reach another component's element through a ref or a name its owner provides with provideFocusTarget (keys/focus.ts), never by document query." },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const file = context.filename.replaceAll("\\", "/");

        if (!file.includes("/apps/desktop/src/") || file.includes("/apps/desktop/src/testing/") || file.includes("/apps/desktop/src/perf/") || file.endsWith("/apps/desktop/src/keys/focus.ts")) return;
        const callee = node.callee;

        if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier" || callee.object.name !== "document") return;
        if (callee.property.type !== "Identifier" || !callee.property.name.startsWith("querySelector")) return;
        context.report({ node, messageId: "query" });
      },
    };
  },
});

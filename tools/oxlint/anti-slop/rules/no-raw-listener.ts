import { defineRule } from "@oxlint/plugins";

/** A listener that lives as long as its owner is attached through `makeEventListener`, which the owner disposes. */
export const noRawListenerRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Reject .addEventListener( in the App outside testing/ and perf/." },
    messages: { raw: "Attach with makeEventListener from @solid-primitives/event-listener, or add a `// listener-owner: <why>` line above." },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const file = context.filename.replaceAll("\\", "/");

        if (!file.includes("/apps/desktop/src/") || file.includes("/apps/desktop/src/testing/") || file.includes("/apps/desktop/src/perf/")) return;
        if (node.callee.type !== "MemberExpression" || node.callee.property.name !== "addEventListener") return;
        const line = node.loc.start.line;
        const above = context.sourceCode.lines[line - 2] ?? "";

        if (/\/\/\s*listener-owner:/.test(above) || /\/\/\s*listener-owner:/.test(context.sourceCode.lines[line - 1] ?? "")) return;
        context.report({ node, messageId: "raw" });
      },
    };
  },
});

import { defineRule } from "@oxlint/plugins";

const GUARDED = /\btry\s*\{|\.catch\(|\bfailureOf\b/;
const OWNED = /\/\/ read-guarded: \S/;

/** U7776b: an async body behind createMemo or createSignal must catch its rejection, or Solid halts its reactive system. */
export const noUnguardedAsyncReadRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Reject createMemo and createSignal async bodies with no failure handling." },
    messages: { unguarded: "Catch this read's rejection with failureOf, try or .catch and show the failure with a Retry, or add a `// read-guarded: <where>` line above." },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const file = context.filename.replaceAll("\\", "/");

        if (!file.includes("/apps/desktop/src/") || /\.test\.[^/]+$/.test(file)) return;
        if (node.callee.type !== "Identifier" || (node.callee.name !== "createMemo" && node.callee.name !== "createSignal")) return;
        const body = node.arguments[0];

        if (!body || (body.type !== "ArrowFunctionExpression" && body.type !== "FunctionExpression") || !body.async) return;
        const lines = context.sourceCode.getText().split("\n");
        const above = lines[node.loc.start.line - 2] ?? "";

        if (!GUARDED.test(context.sourceCode.getText(body)) && !OWNED.test(above)) context.report({ node, messageId: "unguarded" });
      },
    };
  },
});

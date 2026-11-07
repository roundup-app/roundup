import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const CHAIN = new Set(["then", "catch", "finally"]);

/** The identifier a `.then(...)` chain starts from, or null when the expression is not such a chain. */
function chainRoot(expression: ESTree.Node): string | null {
  let node = expression;
  let chained = false;

  while (node.type === "CallExpression" && node.callee.type === "MemberExpression" && !node.callee.computed
    && node.callee.property.type === "Identifier" && CHAIN.has(node.callee.property.name)) {
    chained = true;
    node = node.callee.object;
  }

  return chained && node.type === "Identifier" ? node.name : null;
}

/** Ordered async work goes through one queue with an idle promise, never an `x = x.then(…)` chain kept in a `let`. */
export const noPromiseChainQueueRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow a promise chain kept in a variable as a queue." },
    messages: {
      chain: "Run ordered async work on one queue with an idle promise (`state/serialQueue.ts`), not an `x = x.then(…)` chain.",
    },
  },
  createOnce(context) {
    return {
      AssignmentExpression(node) {
        if (node.operator !== "=" || node.left.type !== "Identifier") return;
        if (chainRoot(node.right) === node.left.name) context.report({ node, messageId: "chain" });
      },
    };
  },
});

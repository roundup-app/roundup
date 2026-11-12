import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const EQUALITY = new Set(["===", "!==", "==", "!="]);

const isStringify = (node: ESTree.Expression | ESTree.PrivateIdentifier): boolean =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "JSON" &&
  node.callee.property.type === "Identifier" &&
  node.callee.property.name === "stringify";

/** Ban comparing two `JSON.stringify` results, which depends on key order and hides the fields that matter. */
export const noJsonEqualityRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow `JSON.stringify(a) === JSON.stringify(b)`; compare the fields that matter.",
    },
    messages: {
      jsonEquality:
        "Compare the fields that matter, or `reconcile` a store. A `JSON.stringify` equality depends on key order and compares fields nobody named.",
    },
  },
  createOnce(context) {
    return {
      BinaryExpression(node) {
        if (EQUALITY.has(node.operator) && isStringify(node.left) && isStringify(node.right)) {
          context.report({ node, messageId: "jsonEquality" });
        }
      },
    };
  },
});

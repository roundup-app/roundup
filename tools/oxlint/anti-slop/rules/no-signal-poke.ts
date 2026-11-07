import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const isParameter = (node: ESTree.Node | null | undefined, name: string) => node?.type === "Identifier" && node.name === name;

/** A setter callback that only re-triggers readers: `x + 1`, `[...x]`, or a whole Set or Map copy of `x`. */
function isPoke(body: ESTree.Node, name: string): boolean {
  if (body.type === "BinaryExpression") return body.operator === "+" && isParameter(body.left, name) && body.right.type === "Literal" && body.right.value === 1;
  if (body.type === "ArrayExpression") {
    const [only] = body.elements;

    return body.elements.length === 1 && only?.type === "SpreadElement" && isParameter(only.argument, name);
  }

  if (body.type === "NewExpression") {
    return body.callee.type === "Identifier" && (body.callee.name === "Set" || body.callee.name === "Map")
      && body.arguments.length === 1 && isParameter(body.arguments[0], name);
  }

  return false;
}

/** One store per holder: a setter given `x => x + 1` or a whole copy of `x` pokes a signal beside a mutable holder. */
export const noSignalPokeRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow setters that re-run readers with a counter bump or a whole-collection copy." },
    messages: {
      poke: "Hold the data in a `solid-js/store` so readers track it; a counter bump or whole copy only pokes a signal beside a mutable holder.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !/^set[A-Z0-9_]/.test(node.callee.name)) return;
        const [callback] = node.arguments;

        if (node.arguments.length !== 1 || callback?.type !== "ArrowFunctionExpression") return;
        const [first] = callback.params;

        if (callback.params.length !== 1 || first?.type !== "Identifier") return;
        const body = callback.body.type === "BlockStatement" ? null : callback.body;

        if (body !== null && isPoke(body, first.name)) context.report({ node, messageId: "poke" });
      },
    };
  },
});

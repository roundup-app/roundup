import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type Fn = ESTree.Function | ESTree.ArrowFunctionExpression;

type Frame = { name: string | null; node: ESTree.Node; returns: number; nulls: number };

const isNull = (node: ESTree.Expression | null | undefined): boolean => node?.type === "Literal" && node.value === null && node.raw === "null";

const isComponentName = (name: string | null): name is string => name !== null && /^[A-Z]/.test(name);

/** Ban a component whose every return is `null`: it hosts effects, and a lifetime per key is `mapArray`. */
export const noNullComponentRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow a component that renders `null` only to host effects.",
    },
    messages: {
      nullComponent:
        "`{{name}}` renders `null` only to host effects. Run the lifetime per key in `mapArray` and read the result from the parent.",
    },
  },
  createOnce(context) {
    const frames: Frame[] = [];

    const nameOf = (node: Fn): string | null => {
      if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
        if (node.id) return node.id.name;
      }

      const parent = node.parent;

      return parent?.type === "VariableDeclarator" && parent.id.type === "Identifier" ? parent.id.name : null;
    };

    const enter = (node: Fn) => {
      const frame: Frame = { name: nameOf(node), node, returns: 0, nulls: 0 };

      if (node.type === "ArrowFunctionExpression" && node.expression) {
        frame.returns = 1;
        frame.nulls = isNull(node.body as ESTree.Expression) ? 1 : 0;
      }

      frames.push(frame);
    };

    const leave = () => {
      const frame = frames.pop();

      if (frame && isComponentName(frame.name) && frame.returns > 0 && frame.returns === frame.nulls) {
        context.report({ node: frame.node, messageId: "nullComponent", data: { name: frame.name } });
      }
    };

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": leave,
      FunctionExpression: enter,
      "FunctionExpression:exit": leave,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": leave,
      ReturnStatement(node) {
        const frame = frames.at(-1);

        if (!frame) return;

        frame.returns += 1;

        if (isNull(node.argument)) frame.nulls += 1;
      },
    };
  },
});

import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

/** The calls a body makes as statements, or null when a statement does anything but read, branch, declare or call. */
function statementCalls(node: ESTree.Node): ESTree.CallExpression[] | null {
  switch (node.type) {
    case "BlockStatement":
      return node.body.reduce<ESTree.CallExpression[] | null>((calls, each) => {
        const inner = statementCalls(each);

        return calls === null || inner === null ? null : [...calls, ...inner];
      }, []);
    case "IfStatement": {
      const consequent = statementCalls(node.consequent);
      const alternate = node.alternate ? statementCalls(node.alternate) : [];

      return consequent === null || alternate === null ? null : [...consequent, ...alternate];
    }
    case "VariableDeclaration":
    case "ReturnStatement":
      return [];
    case "ExpressionStatement":
      return node.expression.type === "CallExpression" ? [node.expression] : null;
    default:
      return null;
  }
}

/** The callback of `createEffect(() => …)` or `createEffect(on(deps, () => …))`, and whether `on` wraps it. */
function callbackOf(node: ESTree.CallExpression): { callback: ESTree.Node | undefined; viaOn: boolean } {
  const [first] = node.arguments;

  if (first?.type === "ArrowFunctionExpression") return { callback: first, viaOn: false };

  if (first?.type === "CallExpression" && first.callee.type === "Identifier" && first.callee.name === "on") return { callback: first.arguments[1], viaOn: true };

  return { callback: undefined, viaOn: false };
}

/** An effect that reads its previous run (`on(deps, (value, previous) => …)`, `createEffect(previous => …)`) is a latch or an accumulator. */
const readsPrevious = (callback: ESTree.ArrowFunctionExpression, viaOn: boolean): boolean => callback.params.length > (viaOn ? 1 : 0);

/** An effect never writes a signal from other signals: that is a memo of its source, or a store the item's presence filters. */
export const noRepairEffectRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow a createEffect whose body only reads signals and calls setters." },
    messages: {
      repair: "Derive the value: a writable memo of its key, or `createItemFailures` for a failure that belongs to an item. An effect that only reads signals and calls setters repairs a stale value one pass late.",
    },
  },
  createOnce(context) {
    // Only a setter this file made from `createSignal` and the like writes a signal the effect derives; an imported one reaches an outside system.
    const setters = new Set<string>();

    return {
      before() {
        setters.clear();
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ArrayPattern" || node.init?.type !== "CallExpression") return;
        const setter = node.id.elements[1];

        if (setter?.type === "Identifier") setters.add(setter.name);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "createEffect") return;
        const { callback, viaOn } = callbackOf(node);

        if (callback?.type !== "ArrowFunctionExpression" || readsPrevious(callback, viaOn)) return;
        const calls = callback.body.type === "BlockStatement" ? statementCalls(callback.body)
          : callback.body.type === "CallExpression" ? [callback.body] : null;

        if (calls !== null && calls.length > 0 && calls.every(call => call.callee.type === "Identifier" && setters.has(call.callee.name))) context.report({ node, messageId: "repair" });
      },
    };
  },
});

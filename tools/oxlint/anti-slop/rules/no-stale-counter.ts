import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const COUNTER = "latest";
const FLAG = "alive";

const isName = (node: ESTree.Node | null | undefined, name: string) => node?.type === "Identifier" && node.name === name;

/** A hand-kept guard against a stale answer: a `latest` counter or an `alive` flag, flagged where it is declared. */
export const noStaleCounterRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow `latest` counters and `alive` flags that guard an async answer." },
    messages: {
      counter: "Read it with `createResource` keyed on the id, and create state that belongs to one id under a keyed `Show`; a `latest` counter or `alive` flag guards a stale answer by hand.",
    },
  },
  createOnce(context) {
    return {
      VariableDeclarator(node) {
        const { id, init } = node;
        const counter = isName(id, COUNTER) && init?.type === "Literal" && init.value === 0;
        const flag = isName(id, FLAG) && init?.type === "Literal" && init.value === true;

        if (counter || flag) context.report({ node, messageId: "counter" });
      },
    };
  },
});

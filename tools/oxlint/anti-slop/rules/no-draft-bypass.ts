import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const STEPS = new Set(["edit", "submit", "settle"]);
const HOLDERS = /^(drafts?|retained|storage)$/;
const OWNERS = /\/state\/(draftField|drafts)\.ts$/;
const TESTS = /\.test\.tsx?$|\/testing\//;

/** The rightmost name of a receiver: `drafts`, `connected.drafts`, `api().drafts`. */
const holderName = (node: ESTree.Node): string | null => {
  if (node.type === "Identifier") return node.name;

  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") return node.property.name;

  return null;
};

/** Unfinished input goes through `createDraftField`: a draft's edit, submit and settle, and the 15 s no-reply timeout, belong to `state/draftField.ts`. */
export const noDraftBypassRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow drafts.edit, drafts.submit, drafts.settle and a 15_000 timeout outside the draft field." },
    messages: {
      bypass: "Keep, send, settle and discard through `createDraftField` (state/draftField.ts); a surface keeps no revision of its own.",
      timeout: "The 15 s no-reply settlement belongs to `createDraftField` (state/draftField.ts).",
    },
  },
  createOnce(context) {
    const exempt = () => OWNERS.test(context.filename) || TESTS.test(context.filename);

    return {
      CallExpression(node) {
        if (exempt()) return;
        const { callee } = node;

        if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && STEPS.has(callee.property.name)) {
          const holder = holderName(callee.object);

          if (holder !== null && HOLDERS.test(holder)) context.report({ node, messageId: "bypass" });

          return;
        }

        if (callee.type !== "Identifier" || callee.name !== "setTimeout") return;
        const delay = node.arguments[1];

        if (delay?.type === "Literal" && delay.value === 15000) context.report({ node, messageId: "timeout" });
      },
    };
  },
});

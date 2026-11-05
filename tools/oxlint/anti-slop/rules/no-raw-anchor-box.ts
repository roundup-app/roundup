import { defineRule } from "@oxlint/plugins";

const READERS = new Set(["getAnchorRect", "getPosition"]);

/** U6236c: a floating surface reads its anchor box through `ui/anchorBox.ts`, which refuses a detached element. */
export const noRawAnchorBoxRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Reject getBoundingClientRect inside getAnchorRect or getPosition." },
    messages: { raw: "Read the anchor box with anchorBox from ui/anchorBox.ts." },
  },
  createOnce(context) {
    let inside = 0;
    const reader = (node) => node.key && (node.key.name ?? node.key.value) !== undefined && READERS.has(node.key.name ?? node.key.value);

    return {
      Property(node) { if (reader(node)) inside += 1; },
      "Property:exit"(node) { if (reader(node)) inside -= 1; },
      CallExpression(node) {
        const file = context.filename.replaceAll("\\", "/");

        if (inside > 0 && !file.endsWith("/apps/desktop/src/ui/anchorBox.ts") && node.callee.type === "MemberExpression" && node.callee.property.name === "getBoundingClientRect") {
          context.report({ node, messageId: "raw" });
        }
      },
    };
  },
});

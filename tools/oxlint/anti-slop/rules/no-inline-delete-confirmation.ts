import { defineRule } from "@oxlint/plugins";

const retired = new Set(["deletePad", "ownsItYouMayDeleteAnyPad", "unsavedChangesAreLost"]);
const native = new Set(["padDeleteQuestion", "padDeleteOwnership", "padDeleteUnsaved", "deleteTodoQuestion", "removeQuestion", "stopAndRemoveQuestion", "closeQuestion", "closeTerminalWarning", "closeTerminalOutputWarning"]);

/** Delete questions belong to native alerts; the retired inline catalogue must stay absent. */
export const noInlineDeleteConfirmationRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep deletion confirmation copy on the native alert path." },
    messages: { inline: "Use the native confirmation popup; do not render deletion questions inline.", retired: "Remove retired inline delete-confirmation copy; use the native alert question." },
  },
  createOnce(context) {
    return {
      Property(node) {
        if (!context.filename.replaceAll("\\", "/").endsWith("/apps/desktop/src/copy.ts")) return;
        const name = node.key.type === "Identifier" ? node.key.name : node.key.type === "Literal" ? node.key.value : null;

        if (retired.has(String(name))) context.report({ node, messageId: "retired" });
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || node.object.name !== "copy") return;
        const name = node.property.type === "Identifier" && !node.computed ? node.property.name : node.property.type === "Literal" ? node.property.value : null;

        if (!native.has(String(name))) return;
        let ancestor = node.parent;

        while (ancestor) {
          if (ancestor.type === "JSXAttribute" && ancestor.name.type === "JSXIdentifier" && ancestor.name.name === "question" && ancestor.parent.name.type === "JSXIdentifier" && ancestor.parent.name.name === "NativeAlert") return;

          if (ancestor.type === "JSXElement" || ancestor.type === "JSXFragment") {
            context.report({ node, messageId: "inline" });

            return;
          }
          ancestor = ancestor.parent;
        }
      },
    };
  },
});

import { defineRule } from "@oxlint/plugins";

/** Keep App tooltips on the shared anchor contract. */
export const noTooltipBypassRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require shared Tooltip ownership and prohibit native titles." },
    messages: { bypass: "Use the shared Tip; tooltip primitives belong in ui/.", title: "Remove native title; use the shared Tip on its owning element." },
  },
  createOnce(context) {
    return {
      ImportDeclaration(node) {
        const file = context.filename.replaceAll("\\", "/");

        if (file.includes("/apps/desktop/src/") && !file.includes("/apps/desktop/src/ui/") && (node.source.value === "@ark-ui/solid/tooltip" || /(?:^|\/)ui\/Tooltip(?:\.tsx?)?$/.test(node.source.value))) {
          context.report({ node, messageId: "bypass" });
        }
      },
      JSXOpeningElement(node) {
        const file = context.filename.replaceAll("\\", "/");

        if (!file.includes("/apps/desktop/src/")) return;
        if (!file.includes("/apps/desktop/src/ui/") && node.name.type === "JSXMemberExpression" && node.name.object.type === "JSXIdentifier" && node.name.object.name === "Tooltip" && node.name.property.name === "Root") {
          context.report({ node, messageId: "bypass" });
        }
        for (const attribute of node.attributes) {
          if (attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === "title") {
            context.report({ node: attribute, messageId: "title" });
          }
        }
      },
    };
  },
});

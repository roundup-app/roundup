import { defineRule } from "@oxlint/plugins";

const EXTENSION = /\.[cm]?[jt]sx?$|\.json$/;

/** Require a file extension on relative imports, as Node's native config loader does. */
export const requireImportExtensionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Require relative imports to end in a file extension.",
    },
    messages: {
      missingExtension: "Add the file extension to the relative import `{{source}}`.",
    },
  },
  createOnce(context) {
    const check = (node: { source: { value: string } | null }) => {
      const source = node.source?.value;
      if (source === undefined || !source.startsWith(".") || EXTENSION.test(source)) return;
      context.report({ node: node.source, messageId: "missingExtension", data: { source } });
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
});

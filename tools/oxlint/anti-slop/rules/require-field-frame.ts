import { defineRule } from "@oxlint/plugins";

/** U6545c: the shared frame classes of `ui/Field.css`. */
const FRAME_CLASSES = ["field-frame", "field-inline"];

/** Inputs that are not text fields. */
const NON_TEXT_TYPES = new Set(["checkbox", "radio", "number", "range", "hidden", "file", "button", "submit", "color"]);

/**
 * The only exceptions, each with its reason: Ark's hidden inputs behind a control that draws its own
 * mark. A new entry needs a reason a reviewer accepts.
 */
const EXEMPT_FILES: Record<string, string> = {
  "/apps/desktop/src/ui/Switch.tsx": "the switch's hidden checkbox input",
  "/apps/desktop/src/ui/Checkbox.tsx": "the checkbox's hidden input",
  "/apps/desktop/src/ui/SegmentGroup.tsx": "the segment's hidden radio input",
  "/apps/desktop/src/ui/RadioGroup.tsx": "the radio's hidden input",
};

const isTestSupport = (file: string) => /\.test\.|Fixture\.tsx$|Harness\.tsx$|\/testing\//.test(file);

const nameOf = (node: any): string => {
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") return `${nameOf(node.object)}.${node.property.name}`;

  return "";
};

const attributeNamed = (node: any, name: string) =>
  node.attributes.find((attribute: any) => attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === name);

const staticText = (attribute: any): string => {
  const value = attribute?.value;

  if (value?.type === "Literal") return String(value.value);
  if (value?.type === "JSXExpressionContainer") {
    const expression = value.expression;

    if (expression.type === "Literal") return String(expression.value);
    if (expression.type === "TemplateLiteral") return expression.quasis.map((quasi: any) => quasi.value.cooked).join(" ");
  }

  return "";
};

/** U6545c: a text field wears the shared frame, as `Field.Input`, `Field.Textarea` or a frame class. */
export const requireFieldFrameRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require every text field to wear the shared field frame." },
    messages: { bare: "A text field wears the shared frame: use Field.Input or Field.Textarea, or class `field-frame` (`field-inline` to edit in place)." },
  },
  createOnce(context) {
    return {
      JSXOpeningElement(node) {
        const file = context.filename.replaceAll("\\", "/");
        const at = file.indexOf("/apps/desktop/src/");

        if (at < 0 || isTestSupport(file) || file.slice(at) in EXEMPT_FILES) return;

        const name = nameOf(node.name);
        const editable = attributeNamed(node, "contenteditable") ?? attributeNamed(node, "contentEditable");
        const isEditable = editable !== undefined && !["false", "inherit"].includes(staticText(editable)) || (editable !== undefined && editable.value === null);
        const isField = name === "input" || name === "textarea" || name === "Editable.Input" || isEditable;

        if (!isField) return;
        if (NON_TEXT_TYPES.has(staticText(attributeNamed(node, "type")))) return;
        if (FRAME_CLASSES.some(frame => staticText(attributeNamed(node, "class")).split(/\s+/).includes(frame))) return;

        context.report({ node, messageId: "bare" });
      },
    };
  },
});

import { $markSchema, $nodeSchema, $remark } from "@milkdown/kit/utils";
import type { MarkdownNode } from "@milkdown/kit/transformer";
import type { Options, Handle } from "mdast-util-to-markdown";

import type { Parent, PhrasingContent, BlockContent } from "mdast";

type PadInlineMarkdown = Parent & { type: "padColour" | "padHighlight"; colour?: string; children: PhrasingContent[] };

type PadCalloutMarkdown = Parent & { type: "padCallout"; kind: string; children: BlockContent[] };

declare module "mdast" {
  interface PhrasingContentMap {
    padColour: PadInlineMarkdown;
    padHighlight: PadInlineMarkdown;
  }

  interface BlockContentMap {
    padCallout: PadCalloutMarkdown;
  }

  interface RootContentMap {
    padCallout: PadCalloutMarkdown;
  }
}

export const calloutKinds = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

export const padColours = ["blue", "green", "purple", "red", "amber"];

const transform = (node: MarkdownNode) => {
  const nodes = node.children;

  if (!nodes) return;

  if (node.type === "blockquote") {
    const first = nodes[0]?.children?.[0];

    if (first?.type === "text" && first.value != null) {
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/.exec(String(first.value));

      if (match) {
        node.type = "padCallout";
        node.kind = match[1];
        first.value = String(first.value).slice(match[0].length);

        if (!first.value) nodes[0]!.children!.shift();
      }
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    const opening = nodes[i];

    if (opening?.type !== "html") continue;
    const colour = /^<span data-pad-color="(blue|green|purple|red|amber)">$/.exec(String(opening.value));
    const highlight = opening.value === "<mark>";

    if (!colour && !highlight) continue;
    const closing = highlight ? "</mark>" : "</span>";
    const end = nodes.findIndex((child, index) => index > i && child.type === "html" && child.value === closing);

    if (end < 0) continue;
    nodes.splice(i, end - i + 1, { type: highlight ? "padHighlight" : "padColour", colour: colour?.[1], children: nodes.slice(i + 1, end) });
  }

  nodes.forEach(transform);
};

export const padFormatMarkdown = $remark("padFormats", () => function () {
  const handlers = {
    padColour(node, _parent, state, info) {
      // SAFETY: this handler is reached only for the custom phrasing node emitted by the Pad mark schema.
      return `<span data-pad-color="${(node as MarkdownNode).colour}">${state.containerPhrasing(node as Parameters<typeof state.containerPhrasing>[0], info)}</span>`;
    },
    padHighlight(node, _parent, state, info) {
      // SAFETY: the schema emits a phrasing parent with children for this custom mark.
      return `<mark>${state.containerPhrasing(node as Parameters<typeof state.containerPhrasing>[0], info)}</mark>`;
    },
    padCallout(node, _parent, state, info) {
      // SAFETY: the callout schema emits a block parent, serialized by the installed blockquote handler.
      const callout = node as Parameters<typeof state.containerFlow>[0] & { kind: string };
      const quote = { ...callout, type: "blockquote" as const, children: [{ type: "paragraph" as const, children: [{ type: "html" as const, value: `[!${callout.kind}]` }] }, ...callout.children] };

      return state.handlers.blockquote!(quote, undefined, state, info).replace(/^(> \[!\w+\])\n> ?\n/, "$1\n");
    },
  } satisfies Record<string, Handle>;

  const extensions: Options = { handlers };
  const data = this.data();
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), extensions];

  return tree => { // SAFETY: Milkdown consumes this same remark tree as MarkdownNode.
    transform(tree as MarkdownNode); };
});

export const padCallout = $nodeSchema("padCallout", () => ({
  content: "block+", group: "block", defining: true,
  attrs: { kind: { default: "NOTE" } },
  toDOM: node => ["blockquote", { "data-pad-callout": node.attrs.kind.toLowerCase() }, ["div", { contenteditable: "false", class: "pad-callout-label" }, node.attrs.kind], ["div", 0]],
  parseMarkdown: { match: node => node.type === "padCallout", runner: (state, node, type) => { state.openNode(type, { kind: node.kind }).next(node.children).closeNode(); } },
  toMarkdown: { match: node => node.type.name === "padCallout", runner: (state, node) => { state.openNode("padCallout", undefined, { kind: node.attrs.kind }).next(node.content).closeNode(); } },
}));

export const padHighlight = $markSchema("padHighlight", () => ({
  toDOM: () => ["mark", 0],
  parseMarkdown: { match: node => node.type === "padHighlight", runner: (state, node, type) => { state.openMark(type).next(node.children).closeMark(type); } },
  toMarkdown: { match: mark => mark.type.name === "padHighlight", runner: (state, mark) => { state.withMark(mark, "padHighlight"); } },
}));

export const padColour = $markSchema("padColour", () => ({
  attrs: { colour: { default: "blue" } },
  toDOM: mark => ["span", { "data-pad-color": mark.attrs.colour }, 0],
  parseMarkdown: { match: node => node.type === "padColour", runner: (state, node, type) => { state.openMark(type, { colour: node.colour }).next(node.children).closeMark(type); } },
  toMarkdown: { match: mark => mark.type.name === "padColour", runner: (state, mark) => { state.withMark(mark, "padColour", undefined, { colour: mark.attrs.colour }); } },
}));

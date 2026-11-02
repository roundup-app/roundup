import { $node, $remark, $view } from "@milkdown/kit/utils";
import type { MarkdownNode } from "@milkdown/kit/transformer";
import { copy } from "./copy";

const opening = /^<details>\s*<summary>For Agents<\/summary>\s*$/;

const closing = /^<\/details>\s*$/;

/** U5561: recognize only the attribute-free, trailing Pad disclosure. */
export const agentDetailsRemark = $remark("pad-agent-details", () => () => (tree, file) => {
  // SAFETY: Milkdown extends mdast with custom node kinds consumed by its configured schemas.
  const nodes = tree.children as MarkdownNode[];

  if (!nodes) return;
  const source = String(file);

  const html = (node: MarkdownNode) => node.type === "paragraph" && node.children?.length === 1 ? node.children[0]! : node;
  const start = nodes.findIndex(node => html(node).type === "html" && opening.test(String(html(node).value)));
  const last = nodes.at(-1);

  if (start < 0 || !last || html(last).type !== "html" || !closing.test(String(html(last).value))) return;
  const first = nodes[start]!;
  const from = first.position?.start.offset;
  const to = last.position?.end.offset;

  if (from === undefined || to === undefined) return;
  const value = source.slice(from, to);

  if ((value.match(/<details>/g) ?? []).length !== 1) return;
  nodes.splice(start, nodes.length - start, { type: "padAgentDetails", value, position: { start: first.position!.start, end: last.position!.end } });
});

export const agentDetailsNode = $node("pad_agent_details", () => ({
  group: "block",
  content: "text*",
  atom: true,
  isolating: true,
  marks: "",
  parseDOM: [{ tag: "details[data-pad-agents]" }],
  toDOM: () => ["details", { "data-pad-agents": "" }, ["summary", { contenteditable: "false" }, copy.forAgents], ["pre", 0]],
  parseMarkdown: {
    match: node => node.type === "padAgentDetails",
    runner: (state, node, type) => { state.openNode(type).addText(String(node.value)).closeNode(); },
  },
  toMarkdown: {
    match: node => node.type.name === "pad_agent_details",
    runner: (state, node) => { state.addNode("html", undefined, node.textContent); },
  },
}));

/** Native details owns pointer/keyboard toggling; open is presentation, never document state. */
export const agentDetailsView = $view(agentDetailsNode, () => (node, view, getPos) => {
  let current = node;
  const dom = document.createElement("details");
  dom.dataset.padAgents = "";
  const summary = document.createElement("summary");
  summary.textContent = copy.forAgents;
  summary.contentEditable = "false";
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", copy.forAgents);
  input.readOnly = !view.editable;
  const body = (source: string) => source.replace(/^<details>\s*<summary>For Agents<\/summary>\r?\n\r?\n/, "").replace(/\r?\n\r?\n<\/details>$/, "");
  input.value = body(node.textContent);
  input.addEventListener("input", () => {
    const pos = getPos();

    if (pos === undefined || !view.editable) return;
    const source = `<details>\n<summary>For Agents</summary>\n\n${input.value}\n\n</details>`;
    view.dispatch(view.state.tr.replaceWith(pos + 1, pos + current.nodeSize - 1, view.state.schema.text(source)));
  });
  dom.append(summary, input);

  return {
    dom,
    stopEvent: () => true,
    ignoreMutation: () => true,
    update(next) {
      if (next.type !== current.type) return false;
      current = next;
      input.readOnly = !view.editable;

      if (input.value !== body(next.textContent)) input.value = body(next.textContent);

      return true;
    },
  };
});

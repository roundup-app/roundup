import { $node, $remark, $view } from "@milkdown/kit/utils";
import type { MarkdownNode } from "@milkdown/kit/transformer";
import { copy } from "./copy";

const opening = /^<details>\s*<summary>([^\r\n]*)<\/summary>\s*$/;

const closing = /^<\/details>\s*$/;

/** U5561: retain each attribute-free toggle as one opaque, source-preserving block. */
export const agentDetailsRemark = $remark("pad-agent-details", () => () => (tree, file) => {
  // SAFETY: Milkdown extends mdast with custom node kinds consumed by its configured schemas.
  const nodes = tree.children as MarkdownNode[];

  if (!nodes) return;
  const source = String(file);
  const html = (node: MarkdownNode) => node.type === "paragraph" && node.children?.length === 1 ? node.children[0]! : node;

  for (let start = 0; start < nodes.length; start++) {
    const first = nodes[start]!;

    if (html(first).type !== "html" || !opening.test(String(html(first).value))) continue;
    let end = start + 1;

    while (end < nodes.length && !(html(nodes[end]!).type === "html" && closing.test(String(html(nodes[end]!).value)))) end++;
    const last = nodes[end];
    const from = first.position?.start.offset;
    const to = last?.position?.end.offset;

    if (!last || from === undefined || to === undefined) continue;
    const value = source.slice(from, to);

    if ((value.match(/<details>/g) ?? []).length !== 1) continue;
    nodes.splice(start, end - start + 1, { type: "padAgentDetails", value, position: { start: first.position!.start, end: last.position!.end } });
  }
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

  const label = (source: string) => {
    const value = source.match(/^<details>\s*<summary>([^\r\n]*)<\/summary>/)?.[1];

    return value?.trim() ? value : copy.toggle;
  };

  summary.textContent = label(node.textContent);
  summary.setAttribute("aria-label", summary.textContent);
  summary.setAttribute("aria-expanded", "false");
  dom.addEventListener("toggle", () => summary.setAttribute("aria-expanded", String(dom.open)));
  const title = document.createElement("input");
  title.type = "text";
  title.setAttribute("aria-label", copy.toggleLabel);
  title.value = label(node.textContent);
  title.spellcheck = false;
  title.setAttribute("autocorrect", "off");
  title.autocapitalize = "off";
  summary.contentEditable = "false";
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", label(node.textContent));
  input.readOnly = !view.editable;
  const body = (source: string) => source.replace(/^<details>\s*<summary>[^\r\n]*<\/summary>\r?\n\r?\n/, "").replace(/\r?\n\r?\n<\/details>$/, "");
  input.value = body(node.textContent);

  const save = () => {
    const pos = getPos();

    if (pos === undefined || !view.editable || (title.value === label(current.textContent) && input.value === body(current.textContent))) return;
    const source = `<details>\n<summary>${title.value.trim() ? title.value : copy.toggle}</summary>\n\n${input.value}\n\n</details>`;
    view.dispatch(view.state.tr.replaceWith(pos + 1, pos + current.nodeSize - 1, view.state.schema.text(source)));
  };

  input.addEventListener("input", save);
  title.addEventListener("blur", save);
  title.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      title.blur();
    }
  });
  dom.append(summary);

  if (view.editable) dom.append(title);
  dom.append(input);

  return {
    dom,
    stopEvent: () => true,
    ignoreMutation: () => true,
    update(next) {
      if (next.type !== current.type) return false;
      current = next;
      input.readOnly = !view.editable;

      if (view.editable && !title.isConnected) summary.after(title);
      else if (!view.editable) title.remove();
      const nextLabel = label(next.textContent);

      if (document.activeElement !== title) title.value = nextLabel;

      if (summary.textContent !== nextLabel) {
        summary.textContent = nextLabel;
        summary.setAttribute("aria-label", nextLabel);
        input.setAttribute("aria-label", nextLabel);
      }

      if (input.value !== body(next.textContent)) input.value = body(next.textContent);

      return true;
    },
  };
});

import type { Ctx } from "@milkdown/kit/ctx";
import { parserCtx, remarkCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as DocumentNode } from "@milkdown/kit/prose/model";
import { ParserState } from "@milkdown/kit/transformer";
import type { MarkdownNode } from "@milkdown/kit/transformer";
import { diffArrays } from "diff";

const comparable = (node: DocumentNode): DocumentNode => {
  if (node.isLeaf) return node;
  const content: DocumentNode[] = [];
  node.forEach((child) => content.push(comparable(child)));

  return node.type.create(node.type.name === "heading" ? { ...node.attrs, id: "" } : node.attrs, content, node.marks);
};

const equal = (left: DocumentNode, right: DocumentNode) => comparable(left).eq(comparable(right));

const children = (doc: DocumentNode, caretNodes: WeakSet<DocumentNode>) => {
  const nodes: DocumentNode[] = [];
  doc.forEach((node) => nodes.push(node));

  // Only Crepe-created caret targets lack source; an authored empty paragraph must survive.
  if (nodes.at(-1) && caretNodes.has(nodes.at(-1)!) && nodes.at(-1)!.content.size === 0) nodes.pop();

  return nodes;
};

const emptyParagraph = (node: DocumentNode) => node.type.name === "paragraph" && node.content.size === 0;

type Block = { node: DocumentNode; from: number; to: number };

/** Reconcile editor blocks against their own baseline; null refuses a source mapping we cannot prove. */
export const sourceForDocument = (
  originalSource: string,
  originalDocument: DocumentNode,
  currentDocument: DocumentNode,
  ctx: Ctx,
  caretNodes: WeakSet<DocumentNode>,
): string | null => {
  if (currentDocument.eq(originalDocument)) return originalSource;

  const remark = ctx.get(remarkCtx);
  // SAFETY: Milkdown's configured remark processor returns the MarkdownNode tree consumed by ParserState.
  const tree = remark.runSync(remark.parse(originalSource), originalSource) as MarkdownNode;
  const schema = ctx.get(schemaCtx);
  const newline = originalSource.includes("\r\n") ? "\r\n" : "\n";

  // Milkdown drops a final empty paragraph as a caret target; append one so edited empties serialize too.
  const serialize = (nodes: DocumentNode[]) => ctx.get(serializerCtx)(schema.topNodeType.create(null, [...nodes, schema.nodes.paragraph!.create()]))
    .replace(/\n$/, "").replace(/\n/g, newline);

  const blocks: Block[] = [];
  let previousEnd = 0;

  for (const child of tree.children ?? []) {
    const parser = new ParserState(schema);
    parser.next({ ...tree, children: [child] });
    const parsed = parser.toDoc();
    const from = child.position?.start.offset;
    const to = child.position?.end.offset;

    // Definitions and unsupported opaque nodes have no document block. Their bytes stay in the gaps.
    if (!parsed || parsed.childCount === 0) continue;

    if (parsed.childCount !== 1 || from === undefined || to === undefined || from < previousEnd) return null;

    blocks.push({ node: parsed.child(0), from, to });
    previousEnd = to;
  }

  const before = children(originalDocument, caretNodes);
  const after = children(currentDocument, caretNodes);

  if (!originalSource.trim() && blocks.length === 0 && before.length === 1) {
    const supported = ctx.get(parserCtx)(serialize(before));

    if (supported?.childCount === 1 && emptyParagraph(supported.child(0))) {
      blocks.push({ node: before[0]!, from: 0, to: originalSource.length });
    }
  }

  // Empty editor paragraphs have no remark node, including after an acknowledged save.
  // Give them a zero-width source range at the next block, without consuming authored gaps.
  let sourceIndex = 0;
  const aligned: Block[] = [];

  for (const node of before) {
    const block = blocks[sourceIndex];

    // An acknowledged editor baseline can retain spaces that Markdown normalizes on load.
    const normalized = !block || !equal(block.node, node) ? ctx.get(parserCtx)(serialize([node])) : null;

    if (block && (equal(block.node, node) || (normalized?.childCount === 1 && equal(block.node, normalized.child(0))))) {
      aligned.push(block);
      sourceIndex++;
    } else if ((emptyParagraph(node) || (normalized?.childCount === 1 && emptyParagraph(normalized.child(0)))) && (blocks.length > 0 || !originalSource.trim())) {
      const position = block?.from ?? previousEnd;
      aligned.push({ node, from: position, to: position });
    } else return null;
  }

  if (sourceIndex !== blocks.length) return null;
  blocks.splice(0, blocks.length, ...aligned);

  // Keep identity when ProseMirror retains a node: equal repeated paragraphs can have different authored bytes.
  const retained = new Set(after.filter((node) => before.includes(node)));

  const changes = diffArrays(before, after, {
    comparator: (left, right) => left === right || (!retained.has(left) && equal(left, right)),
  });

  const removed = new Set<DocumentNode>();
  let index = 0;

  for (const change of changes) {
    if (change.removed) change.value.forEach((node) => removed.add(node));
  }

  const moved = new Set<DocumentNode>();
  let ambiguousMove = false;

  const addedText = (nodes: DocumentNode[]) => nodes.map((node) => {
    const exact = before.indexOf(node);

    const candidates = exact !== -1 && removed.has(node) && !moved.has(node)
      ? [blocks[exact]!]
      : blocks.filter((block, i) => removed.has(before[i]!) && !moved.has(before[i]!) && equal(block.node, node));

    if (candidates.length > 1 && new Set(candidates.map((block) => originalSource.slice(block.from, block.to))).size > 1) ambiguousMove = true;

    if (candidates.length === 1) {
      const block = candidates[0]!;
      moved.add(before[blocks.indexOf(block)]!);

      return originalSource.slice(block.from, block.to);
    }

    return serialize([node]);
  }).join(newline + newline);

  let result = "";
  let cursor = 0;

  for (let c = 0; c < changes.length; c++) {
    const change = changes[c]!;

    if (!change.added && !change.removed) {
      index += change.count;
      continue;
    }

    const start = index;
    const deleted = change.removed ? change.count : 0;
    const addition = change.added ? change : changes[c + 1]?.added ? changes[++c] : undefined;
    index += deleted;
    const from = blocks[start]?.from ?? previousEnd;
    const end = deleted ? blocks[index - 1]!.to : from;
    result += originalSource.slice(cursor, from);
    const text = addition && (!deleted || addition.count !== deleted) ? addedText(addition.value) : "";

    if (deleted) {
      const gaps = blocks.slice(start, index - 1).map((block, offset) =>
        originalSource.slice(block.to, blocks[start + offset + 1]!.from),
      );

      const opaque = gaps.some((gap) => /\S/.test(gap));

      if (addition && from === end) {
        result += (start > 0 && from === previousEnd ? newline + newline : "")
          + addedText(addition.value) + (index < blocks.length ? newline + newline : "");
      } else if (addition?.count === deleted) {
        result += addition.value.map((node, offset) => addedText([node]) + (gaps[offset] ?? "")).join("");
      } else {
        // An unmatched structural edit cannot relocate opaque syntax on the user's behalf.
        if (opaque) return null;
        result += text;
      }

      cursor = end;

      if (!addition && !opaque) {
        if (index === blocks.length && start > 0) {
          const precedingGap = originalSource.slice(blocks[start - 1]!.to, from);

          if (!/\S/.test(precedingGap)) result = result.slice(0, result.length - precedingGap.length);
        }

        const next = blocks[index];
        const gapEnd = next?.from ?? originalSource.length;
        const gap = originalSource.slice(end, gapEnd);

        if (next && !/\S/.test(gap)) cursor = gapEnd;
      }
    } else {
      const prefix = start === blocks.length && from > 0 ? newline + newline : "";
      result += prefix + text + (start < blocks.length ? newline + newline : "");
      cursor = from;
    }
  }

  if (ambiguousMove) return null;

  result += originalSource.slice(cursor);
  const reparsed = ctx.get(parserCtx)(result);

  if (!reparsed) return null;
  const reconciled = children(reparsed, caretNodes).filter(node => !emptyParagraph(node));
  const exact = after.filter(node => !emptyParagraph(node));

  if (reconciled.length === exact.length && reconciled.every((node, i) => equal(node, exact[i]!))) return result;
  const supported = ctx.get(parserCtx)(serialize(after));

  if (!supported) return null;
  const represented = children(supported, caretNodes).filter(node => !emptyParagraph(node));

  return reconciled.length === represented.length && reconciled.every((node, i) => equal(node, represented[i]!)) ? result : null;
};

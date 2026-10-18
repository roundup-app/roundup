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

  if (!originalSource && blocks.length === 0 && before.length === 1 && before[0]!.content.size === 0) {
    blocks.push({ node: before[0]!, from: 0, to: 0 });
  }

  if (blocks.length !== before.length || blocks.some((block, index) => !equal(block.node, before[index]!))) return null;

  // Keep identity when ProseMirror retains a node: equal repeated paragraphs can have different authored bytes.
  const retained = new Set(after.filter((node) => before.includes(node)));

  const changes = diffArrays(before, after, {
    comparator: (left, right) => left === right || (!retained.has(left) && equal(left, right)),
  });

  const newline = originalSource.includes("\r\n") ? "\r\n" : "\n";

  const serialize = (nodes: DocumentNode[]) => ctx.get(serializerCtx)(schema.topNodeType.create(null, nodes))
    .replace(/\n$/, "").replace(/\n/g, newline);

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

      if (addition?.count === deleted) {
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
  const reconciled = children(reparsed, caretNodes);

  return reconciled.length === after.length && reconciled.every((node, i) => equal(node, after[i]!)) ? result : null;
};

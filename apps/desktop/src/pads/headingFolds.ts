import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";

/** U7424a: the fold marks sit inside the body, so the browser's Tab order puts them all after the body and none before it. Tab and Shift+Tab from the caret stop on the next and the previous visible mark in document order (the heading's own included going back); in code, lists and tables the key stays theirs, and past the last mark focus moves to the last mark and the key's default carries it on, out of the body. */
const walkFoldMarks = (view: EditorView, event: KeyboardEvent): boolean => {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return false;

  const { $from, head } = view.state.selection;

  for (let depth = $from.depth; depth >= 0; depth--) {
    const { name, spec } = $from.node(depth).type;

    if (spec.code || /list_item|table/.test(name)) return false;
  }

  const found = view.domAtPos(head);
  const at = found.node.childNodes[found.offset] ?? found.node;

  const marks = [...view.dom.querySelectorAll<HTMLElement>("details[data-pad-heading] > summary")].filter(
    (mark) => !mark.closest(".pad-heading-hidden"),
  );

  const target = event.shiftKey
    ? marks.findLast((mark) => at.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_PRECEDING)
    : marks.find((mark) => at.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING && !at.contains(mark));

  if (!target) {
    const last = event.shiftKey ? undefined : marks.at(-1);

    // The native order would return to the body's first mark; start the default Tab from the last one so it leaves the body.
    last?.focus();

    return false;
  }

  event.preventDefault();
  target.focus();

  return true;
};

/** U5575a: decorations hide section blocks; native details owns disclosure interaction. */
export const headingFolds = () => {
  const key = new PluginKey<Set<number>>("pad-heading-folds");

  return new Plugin<Set<number>>({
    key,
    state: {
      init: () => new Set(),
      apply(tr, previous) {
        const folded = new Set<number>();

        for (const pos of previous) {
          const mapped = tr.mapping.mapResult(pos);

          if (!mapped.deleted && tr.doc.nodeAt(mapped.pos)?.type.name === "heading") folded.add(mapped.pos);
        }

        const change: { pos: number; folded: boolean } | undefined = tr.getMeta(key);

        if (change?.folded) folded.add(change.pos);
        else if (change) folded.delete(change.pos);

        return folded;
      },
    },
    props: {
      handleKeyDown: walkFoldMarks,
      decorations(state) {
        const folded = key.getState(state)!;
        const decorations: Decoration[] = [];
        let hiddenBelow: number | undefined;

        state.doc.forEach((node, pos) => {
          const heading = node.type.name === "heading";
          const level = Number(node.attrs.level);

          if (heading && hiddenBelow !== undefined && level <= hiddenBelow) hiddenBelow = undefined;

          if (hiddenBelow !== undefined) {
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "pad-heading-hidden", inert: "", "aria-hidden": "true" }));
          }

          if (!heading) return;
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { "aria-label": node.textContent }));
          decorations.push(Decoration.widget(pos + 1, (view, getPos) => {
            const dom = document.createElement("details");
            dom.dataset.padHeading = "";
            dom.contentEditable = "false";
            dom.open = !folded.has(pos);
            const summary = document.createElement("summary");
            summary.setAttribute("aria-label", node.textContent);
            summary.setAttribute("aria-expanded", String(dom.open));
            dom.append(summary);
            dom.addEventListener("toggle", () => {
              const at = getPos();
              summary.setAttribute("aria-expanded", String(dom.open));

              if (at === undefined || key.getState(view.state)!.has(at - 1) === !dom.open) return;
              view.dispatch(view.state.tr.setMeta(key, { pos: at - 1, folded: !dom.open }));
            });

            return dom;
          }, { key: `heading-${pos}-${node.textContent}`, side: -1, stopEvent: () => true, ignoreSelection: true }));

          if (hiddenBelow === undefined && folded.has(pos)) hiddenBelow = level;
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
};

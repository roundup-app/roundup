import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

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

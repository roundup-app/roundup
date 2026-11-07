import { createContext, For, Show, useContext, type JSX } from "solid-js";
import { TreeView as ArkTreeView } from "@ark-ui/solid/tree-view";
import "./Tree.css";
import "./Row.css";

// SPIKE (U6633a): an Ark-free TreeView with the same parts. Roles, levels and expand state only: no keyboard walk, typeahead or focus management, so it is a lower bound on what an Ark-free Rail costs per drop.
type Any = Record<string, any>;
const Tree_ = createContext<{ expanded: () => string[] }>({ expanded: () => [] });
const Node_ = createContext<{ id: string; level: number; branch: boolean }>({ id: "", level: 1, branch: false });
const plain = (props: Any) => { const { asChild, children, node, indexPath, collection, expandedValue, selectedValue, focusedValue, onFocusChange, onExpandedChange, onSelectionChange, expandOnClick, ref, ...rest } = props; return rest; };

export const TreeView = {
  Root: (props: Any) => <Tree_.Provider value={{ expanded: () => props.expandedValue ?? [] }}><div {...plain(props)} ref={props.ref}>{props.children}</div></Tree_.Provider>,
  Tree: (props: Any) => <div {...plain(props)} role="tree" class={`app-tree ${props.class ?? ""}`}>{props.children}</div>,
  NodeProvider: (props: Any) => {
    const entry = { id: String(props.node?.id ?? ""), level: (props.indexPath?.length ?? 0) || 1, branch: !!props.node?.children };
    return <Node_.Provider value={entry}>{props.children}</Node_.Provider>;
  },
  Branch: (props: Any) => {
    const node = useContext(Node_); const tree = useContext(Tree_);
    const attrs = () => ({ role: "treeitem", "aria-level": node.level, "aria-expanded": tree.expanded().includes(node.id), "data-part": "branch", ...plain(props) });
    return <Show when={!props.asChild} fallback={props.asChild(() => attrs())}><div {...attrs()}>{props.children}</div></Show>;
  },
  BranchControl: (props: Any) => {
    const node = useContext(Node_);
    const attrs = (extra: Any = {}) => ({ "data-part": "branch-control", tabindex: -1, "aria-level": node.level, ...plain(props), ...extra });
    return <Show when={!props.asChild} fallback={props.asChild(attrs)}><div {...attrs()}>{props.children}</div></Show>;
  },
  BranchContent: (props: Any) => { const node = useContext(Node_); const tree = useContext(Tree_); return <div {...plain(props)} role="group" hidden={!tree.expanded().includes(node.id)}>{props.children}</div>; },
  BranchIndicator: (props: Any) => <span {...plain(props)}>{props.children}</span>,
  BranchTrigger: (props: Any) => <Show when={props.asChild} fallback={<button {...plain(props)}>{props.children}</button>}>{props.asChild((extra: Any = {}) => ({ ...plain(props), ...extra }))}</Show>,
  Item: (props: Any) => {
    const node = useContext(Node_);
    const attrs = (extra: Any = {}) => ({ role: "treeitem", "aria-level": node.level, tabindex: -1, "data-part": "item", ...plain(props), ...extra });
    return <Show when={!props.asChild} fallback={props.asChild(attrs)}><div {...attrs()}>{props.children}</div></Show>;
  },
};

/** U402: the dashed trunks and the elbow of a row at `depth`. `trail[k]` tells whether the trunk at level `k` runs on below the row; the last entry is the row's own branch, which stops at its elbow when it is false. A `stem` drops from the row's own mark to its children. */
export const Trunks = (props: { depth: number; trail: readonly boolean[]; stem: boolean }) => (
  <>
    <For each={props.trail.slice(0, -1)}>
      {(runs, at) => <Show when={runs}><span class="tree-pass" aria-hidden="true" style={{ "--level": at() }} /></Show>}
    </For>
    <Show when={props.depth > 0}>
      <span class="tree-branch" aria-hidden="true" data-last={!props.trail.at(-1)} style={{ "--level": props.depth - 1 }} />
    </Show>
    <Show when={props.stem}>
      <span class="tree-stem" aria-hidden="true" style={{ "--level": props.depth }} />
    </Show>
  </>
);

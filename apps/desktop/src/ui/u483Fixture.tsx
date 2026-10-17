import { render } from "solid-js/web";
import { createSignal, For, Show } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/tree-view";
import { TreeView } from "./TreeView";
import { IconButton } from "./IconButton";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

type Node = { id: string; children?: Node[] };

const collection = createTreeCollection<Node>({
  nodeToValue: (node) => node.id,
  nodeToString: (node) => node.id,
  rootNode: { id: "root", children: [{ id: "Alpha", children: [{ id: "Beta", children: [{ id: "Cedar" }] }, { id: "Delta" }] }, { id: "Echo" }] },
});

const u483Fixture = () => {
  const [expanded, expand] = createSignal<string[]>([]);
  const [selected, select] = createSignal<string[]>([]);
  const row = (node: Node) => <><span class="glyph" aria-hidden="true">○</span><span id={`label-${node.id}`}>{node.id}</span><IconButton data-reads="text" tabIndex={-1} aria-label={`Inspect ${node.id}`} onClick={(event) => event.stopPropagation()}>+</IconButton></>;

  const node = (item: Node, indexPath: number[]) => <TreeView.NodeProvider node={item} indexPath={indexPath}>
    <Show when={item.children} fallback={<TreeView.Item aria-labelledby={`label-${item.id}`} data-id={item.id}>{row(item)}</TreeView.Item>}>
      <TreeView.Branch aria-labelledby={`label-${item.id}`} data-id={item.id}>
        <TreeView.BranchControl>{row(item)}</TreeView.BranchControl>
        <TreeView.BranchContent><For each={item.children}>{(child, index) => node(child, [...indexPath, index()])}</For></TreeView.BranchContent>
      </TreeView.Branch>
    </Show>
  </TreeView.NodeProvider>;

  return <TreeView.Root collection={collection} expandedValue={expanded()} selectedValue={selected()} onExpandedChange={(details) => expand(details.expandedValue)} onSelectionChange={(details) => select(details.selectedValue)}>
    <TreeView.Label>Project tree</TreeView.Label>
    <TreeView.Tree><For each={collection.rootNode.children}>{(item, index) => node(item, [index()])}</For></TreeView.Tree>
    <button data-button="quiet" onClick={() => { expand(["Alpha", "Beta"]); select(["Cedar"]); }}>Select Cedar</button>
  </TreeView.Root>;
};

render(u483Fixture, document.getElementById("root")!);

import { TreeView as ArkTreeView } from "@ark-ui/solid/tree-view";
import "./Tree.css";

export const TreeView = {
  ...ArkTreeView,
  Tree: (props: ArkTreeView.TreeProps) => <ArkTreeView.Tree {...props} class={`app-tree ${props.class ?? ""}`} />,
};

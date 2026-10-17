import { createTreeCollection } from "@ark-ui/solid/tree-view";
import { isWorkstream } from "./layout";
import type { RailRow } from "./layout";

/** What Ark's tree walks: the node's id and name (typeahead jumps by it), and its children. A Workstream is a branch even with none. */
export type TreeNode = { id: string; name: string; childrenCount?: number; children?: TreeNode[] };

/** U520: the rows of an unfolded layout (every Workstream open, `✓ n done` lines as the view has them) as the nested tree Ark reads; Ark skips the children of a branch its `expandedValue` leaves out. */
export const railCollection = (rows: readonly RailRow[]) => {
  const root: TreeNode = { id: "", name: "", children: [] };
  const path: TreeNode[] = [root];

  for (const row of rows) {
    if (row.kind !== "node") continue;

    const node: TreeNode = isWorkstream(row.node)
      ? { id: row.node.id, name: row.node.name, childrenCount: 0, children: [] }
      : { id: row.node.id, name: row.node.name };

    const parent = path[row.depth];

    if (!parent) throw new Error(`no parent row at depth ${row.depth} for ${row.node.id}`);

    (parent.children ??= []).push(node);
    path.length = row.depth + 1;
    path.push(node);
  }

  return createTreeCollection<TreeNode>({ nodeToValue: (node) => node.id, nodeToString: (node) => node.name, rootNode: root });
};

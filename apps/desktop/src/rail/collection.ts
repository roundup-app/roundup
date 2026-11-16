import type { TreeItemData } from "@ui-sdk/solid/tree";
import { copy } from "./copy";
import { isWorkstream } from "../state/railTopology";
import type { RailRow } from "./layout";

/** U520: the rows of an unfolded layout (every Workstream and idle branch open) as the nested items the tree walks, with its keys by name (typeahead jumps by it). A Workstream is a branch even with no children. */
export const railItems = (rows: readonly RailRow[]): TreeItemData[] => {
  const root: TreeItemData = { value: "", label: "", children: [] };
  const path: TreeItemData[] = [root];

  for (const row of rows) {
    const item: TreeItemData =
      row.kind === "fold"
        ? {
            value: row.key,
            label: `${row.count}${row.group === "internal" ? copy.internalCount : copy.idleCount}`,
            children: [],
          }
        : isWorkstream(row.node) || row.node.kind === "group"
          ? { value: row.node.id, label: row.node.name, children: [] }
          : { value: row.node.id, label: row.node.name };

    const parent = path[row.depth];

    if (!parent)
      throw new Error(`no item parent at depth ${row.depth} for ${item.value}`);

    (parent.children ??= []).push(item);
    path.length = row.depth + 1;
    path.push(item);
  }

  return root.children ?? [];
};

/** The values of the items that have children or may have, in order. */
export const branchesOf = (items: readonly TreeItemData[]): string[] =>
  items.flatMap((item) =>
    item.children ? [item.value, ...branchesOf(item.children)] : [],
  );

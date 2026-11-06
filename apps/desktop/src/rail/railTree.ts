import { createMemo, type Accessor } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/tree-view";
import { KIND_ICON } from "../ink/kindIcon";
import type { ConnectedProject } from "../state/connectedProject";
import { railCollection } from "./collection";
import { copy } from "./copy";
import { foldIdOf, layoutRail, type NodeRow, type RailRow } from "./layout";
import type { RailSection } from "./persist/storage";

export const sections: { id: RailSection; label: string; icon: typeof KIND_ICON[keyof typeof KIND_ICON] }[] = [
  { id: "workstreams", label: copy.workstreamsHead, icon: KIND_ICON.workstream },
  { id: "modes", label: copy.modesHead, icon: KIND_ICON.mode },
  { id: "agents", label: copy.agentsHead, icon: KIND_ICON.agent },
];

const sameList = (left: readonly unknown[], right: readonly unknown[]) => left.length === right.length && left.every((value, at) => value === right[at]);

/** U3800d: a layout pass draws new row objects for rows that did not change; keeping the old object keeps that row's subtree still. */
const sameRow = (left: RailRow, right: RailRow): boolean => {
  if (left.kind === "node" && right.kind === "node") {
    return left.key === right.key && left.depth === right.depth && left.node === right.node && left.children === right.children && sameList(left.trail, right.trail)
      && (left.collapsed === right.collapsed || (left.collapsed !== null && right.collapsed !== null && sameList(left.collapsed.agents, right.collapsed.agents)));
  }

  if (left.kind === "fold" && right.kind === "fold") {
    return left.key === right.key && left.depth === right.depth && left.parent === right.parent && left.group === right.group && left.status === right.status
      && left.count === right.count && left.open === right.open && sameList(left.trail, right.trail);
  }

  return false;
};

export const createRailTree = (connected: ConnectedProject, unfolded: Accessor<ReadonlySet<string | null>>, rowElement: (id: string) => HTMLElement | undefined) => {
  const { rail, now } = connected;
  const collapsed = rail.collapsed;
  const topology = rail.topology;
  const presentSections = createMemo(() => sections.filter(section => topology().section.includes(section.id)));

  const sectionRows = createMemo(() => presentSections().map(section => ({
    ...section,
    rows: rail.closedSections().has(section.id) ? [] : layoutRail(topology(), { collapsed: collapsed(), unfolded: unfolded(), now: now(), selected: rail.selected() }, section.id),
  })));

  const rows = createMemo(() => sectionRows().flatMap(section => section.rows));

  /** Section branches share Ark's keyboard walk and add one semantic level above their rows. */
  const collection = createMemo(() => {
    const allUnfolded = new Set([...topology().index.keys()].flatMap(id => [id, `internal:${id}`]));
    const selected = rail.selected();
    const chosen = selected === null ? undefined : topology().nodes[topology().index.get(selected) ?? -1];
    const parent = chosen?.parent == null ? undefined : topology().nodes[topology().index.get(chosen.parent) ?? -1];
    const foldId = chosen && parent ? foldIdOf(chosen, parent.id, { collapsed: collapsed(), unfolded: unfolded(), now: now() }) : null;

    // U6238a: a closed fold lifts the selected Agent, so the collection holds it beside its siblings, as the rows do.
    if (foldId !== null && !unfolded().has(foldId)) allUnfolded.delete(foldId);

    const children = presentSections().map(section => ({
      id: `section:${section.id}`, name: section.label,
      children: railCollection(layoutRail(topology(), { collapsed: new Set(), unfolded: allUnfolded, now: now(), selected }, section.id)).rootNode.children ?? [],
    }));

    return createTreeCollection({
      nodeToValue: node => node.id, nodeToString: node => node.name,
      isNodeDisabled: node => Boolean(rowElement(node.id)?.closest("[hidden], [inert], [aria-disabled=true]")),
      rootNode: { id: "", name: "", children },
    });
  });

  const expanded = createMemo(() => collection().getBranchValues().filter(id => {
    const section = sections.find(section => `section:${section.id}` === id);

    return section ? !rail.closedSections().has(section.id) : id.startsWith("fold:") ? unfolded().has(id.slice(5)) : !collapsed().has(id);
  }));

  /** The tree node and index path Ark's providers need for the row `id`. */
  const entryOf = (id: string) => {
    const indexPath = collection().getIndexPath(id);
    const node = indexPath && collection().at(indexPath);

    if (!indexPath || !node) throw new Error(`no node for row ${id}`);

    return { node, indexPath };
  };

  const nodeRows = createMemo(() => rows().filter((row): row is NodeRow => row.kind === "node"));
  const nodeIds = createMemo(() => nodeRows().map((row) => row.node.id));
  const indexOf = createMemo(() => new Map(nodeIds().map((id, at) => [id, at])));
  const treeRows = createMemo(() => nodeRows().map((row) => ({ id: row.node.id, parent: topology().nodes[topology().parent[topology().index.get(row.node.id)!] ?? -1]?.id ?? null })));

  const byKey = createMemo<ReadonlyMap<string, RailRow>>(before => new Map(rows().map((row) => {
    const kept = before?.get(row.key);

    return [row.key, kept && sameRow(kept, row) ? kept : row];
  })));

  return { topology, sectionRows, rows, collection, expanded, entryOf, nodeRows, nodeIds, indexOf, treeRows, byKey };
};

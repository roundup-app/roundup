import { createMemo, type Accessor } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/tree-view";
import { KIND_ICON } from "../ink/kindIcon";
import type { ConnectedProject } from "../state/connectedProject";
import { railCollection } from "./collection";
import { copy } from "./copy";
import { layoutRail, type NodeRow } from "./layout";
import type { RailSection } from "./persist/storage";

export const sections: { id: RailSection; label: string; icon: typeof KIND_ICON[keyof typeof KIND_ICON] }[] = [
  { id: "workstreams", label: copy.workstreamsHead, icon: KIND_ICON.workstream },
  { id: "modes", label: copy.modesHead, icon: KIND_ICON.mode },
  { id: "agents", label: copy.agentsHead, icon: KIND_ICON.agent },
];

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

    const children = presentSections().map(section => ({
      id: `section:${section.id}`, name: section.label,
      children: railCollection(layoutRail(topology(), { collapsed: new Set(), unfolded: allUnfolded, now: now() }, section.id)).rootNode.children ?? [],
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
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));

  return { topology, sectionRows, rows, collection, expanded, entryOf, nodeRows, nodeIds, indexOf, treeRows, byKey };
};

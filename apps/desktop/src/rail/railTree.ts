import { createMemo, type Accessor } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/tree-view";
import { KIND_ICON } from "../ink/kindIcon";
import type { ConnectedProject } from "../state/connectedProject";
import { railCollection } from "./collection";
import { copy } from "./copy";
import { ancestorsOf, layoutRail, type NodeRow } from "./layout";
import type { RailSection } from "./persist/storage";

export const sections: { id: RailSection; label: string; icon: typeof KIND_ICON[keyof typeof KIND_ICON] }[] = [
  { id: "workstreams", label: copy.workstreamsHead, icon: KIND_ICON.workstream },
  { id: "modes", label: copy.modesHead, icon: KIND_ICON.mode },
  { id: "agents", label: copy.agentsHead, icon: KIND_ICON.agent },
];

export const createRailTree = (connected: ConnectedProject, unfolded: Accessor<ReadonlySet<string | null>>, rowElement: (id: string) => HTMLElement | undefined) => {
  const { rail, now } = connected;
  const collapsed = rail.collapsed;

  const sectionNodes = createMemo(() => {
    const roots = new Map(rail.nodes.filter(node => node.parent === null).map(node => [node.id,
      node.kind === "agent" ? "agents" : node.opening_prompt?.trim() ? "modes" : "workstreams"]));

    return sections.map(section => ({ ...section, nodes: rail.nodes.filter(node => roots.get(ancestorsOf(rail.nodes, node.id).at(-1) ?? node.id) === section.id) }));
  });

  const sectionRows = createMemo(() => sectionNodes().filter(section => section.nodes.length > 0).map(section => ({
    ...section,
    rows: rail.closedSections().has(section.id) ? [] : layoutRail(section.nodes, { collapsed: collapsed(), unfolded: unfolded(), now: now() }),
  })));

  const rows = createMemo(() => sectionRows().flatMap(section => section.rows));

  /** Section branches share Ark's keyboard walk and add one semantic level above their rows. */
  const collection = createMemo(() => {
    const children = sectionNodes().filter(section => section.nodes.length > 0).map(section => ({
      id: `section:${section.id}`, name: section.label,
      children: railCollection(layoutRail(section.nodes, { collapsed: new Set(), unfolded: unfolded(), now: now() })).rootNode.children ?? [],
    }));

    return createTreeCollection({
      nodeToValue: node => node.id, nodeToString: node => node.name,
      isNodeDisabled: node => Boolean(rowElement(node.id)?.closest("[hidden], [inert], [aria-disabled=true]")),
      rootNode: { id: "", name: "", children },
    });
  });

  const expanded = createMemo(() => collection().getBranchValues().filter(id => {
    const section = sections.find(section => `section:${section.id}` === id);

    return section ? !rail.closedSections().has(section.id) : !collapsed().has(id);
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
  const treeRows = createMemo(() => nodeRows().map((row) => ({ id: row.node.id, parent: row.node.parent })));
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));

  return { sectionRows, rows, collection, expanded, entryOf, nodeRows, nodeIds, indexOf, treeRows, byKey };
};

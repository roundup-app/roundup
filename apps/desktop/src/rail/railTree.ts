import { createMemo, type Accessor } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/tree-view";
import { KIND_ICON } from "../ink/kindIcon";
import type { ConnectedProject } from "../state/connectedProject";
import { railCollection } from "./collection";
import { copy } from "./copy";
import { foldIdOf, layoutRail, type NodeRow } from "./layout";
import type { RailSection } from "./persist/storage";

export const sections: { id: RailSection; label: string; icon: typeof KIND_ICON[keyof typeof KIND_ICON] }[] = [
  { id: "workstreams", label: copy.workstreamsHead, icon: KIND_ICON.workstream },
  { id: "modes", label: copy.modesHead, icon: KIND_ICON.mode },
  { id: "agents", label: copy.agentsHead, icon: KIND_ICON.agent },
];

type RailNode = { id: string; name: string; childrenCount?: number; children?: RailNode[] };

type Entry = { node: RailNode; indexPath: number[]; branch: boolean };

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

  /** One walk of the collection gives every node its index path; a move then costs O(rows), not a `getIndexPath` scan per row. */
  const entries = createMemo<Map<string, Entry>>((previous) => {
    const next = new Map<string, Entry>();

    const walk = (node: RailNode, indexPath: number[]) => {
      node.children?.forEach((child, at) => {
        const path = [...indexPath, at];
        const kept = previous?.get(child.id);

        const same = kept && kept.indexPath.join() === path.join() && kept.node.name === child.name && kept.node.childrenCount === child.childrenCount
          && (kept.node.children?.map(each => each.id).join() ?? "") === (child.children?.map(each => each.id).join() ?? "");

        // SAFETY: `child` comes from this collection's own rootNode, so isBranchNode reads a node it holds.
        // An unmoved row keeps its entry object, so its provider props do not change.
        next.set(child.id, same ? kept : { node: child, indexPath: path, branch: collection().isBranchNode(child as never) });
        walk(child, path);
      });
    };

    // SAFETY: rootNode's children are the nodes `RailNode` names (id, name, optional childrenCount and children).
    walk(collection().rootNode as RailNode, []);

    return next;
  });

  /** The tree node, index path and branch-ness Ark's providers need for the row `id`; stable while that row is unchanged. */
  const entryOf = (id: string) => {
    const entry = entries().get(id);

    if (!entry) throw new Error(`no node for row ${id}`);

    return entry;
  };

  const nodeRows = createMemo(() => rows().filter((row): row is NodeRow => row.kind === "node"));
  const nodeIds = createMemo(() => nodeRows().map((row) => row.node.id));
  const indexOf = createMemo(() => new Map(nodeIds().map((id, at) => [id, at])));
  const treeRows = createMemo(() => nodeRows().map((row) => ({ id: row.node.id, parent: topology().nodes[topology().parent[topology().index.get(row.node.id)!] ?? -1]?.id ?? null })));
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));

  return { topology, sectionRows, rows, collection, expanded, entryOf, nodeRows, nodeIds, indexOf, treeRows, byKey };
};

import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/tree-view";
import type { RailNode as ProjectNode } from "@contracts/agent/RailNode";
import { KIND_ICON } from "../ink/kindIcon";
import type { ConnectedProject } from "../state/connectedProject";
import { easingOut, reorderMs } from "../ui/reorderMotion";
import { railCollection } from "./collection";
import { copy } from "./copy";
import { foldIdOf, isWorkstream, layoutRail, type NodeRow, type RailRow } from "./layout";
import { placeable } from "./placement";
import type { RailSection } from "./persist/storage";

export const sections: { id: RailSection; label: string; icon: typeof KIND_ICON[keyof typeof KIND_ICON] }[] = [
  { id: "workstreams", label: copy.workstreamsHead, icon: KIND_ICON.workstream },
  { id: "modes", label: copy.modesHead, icon: KIND_ICON.mode },
  { id: "agents", label: copy.agentsHead, icon: KIND_ICON.agent },
];

export const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((each, at) => each === b[at]);

/** A copy the drawing made of a node it did not change is the node: equal field by field. */
const sameNode = (a: ProjectNode, b: ProjectNode): boolean => {
  if (a === b) return true;
  // SAFETY: Object.keys of a RailNode lists its own fields, each a key of RailNode.
  const keys = Object.keys(a) as (keyof ProjectNode)[];

  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
};

const sameRow = (a: RailRow, b: RailRow): boolean => {
  if (a.kind === "node" && b.kind === "node") return sameNode(a.node, b.node) && a.depth === b.depth && a.children === b.children && sameList(a.trail, b.trail)
    && (a.collapsed === null ? b.collapsed === null : b.collapsed !== null && sameList(a.collapsed.agents, b.collapsed.agents));

  return a.kind === "fold" && b.kind === "fold" && a.depth === b.depth && a.parent === b.parent && a.group === b.group && a.status === b.status && a.count === b.count && a.open === b.open && sameList(a.trail, b.trail);
};

type RailNode = { id: string; name: string; childrenCount?: number; children?: RailNode[] };

type Entry = { node: RailNode; indexPath: number[]; branch: boolean };

/** U6550a, M5: a lift or cancel by key is immediate (M1); a lift or cancel changes the rows in one frame; rows that stay slide from where they were drawn and rows that return fade in, on the reorder Tokens. Call the returned function just before the lift changes. */
const createLiftMotion = (container: Accessor<HTMLElement | undefined>, lifted: Accessor<string | null>) => {
  let drawn = new Map<string, number>();
  let keyed = false;
  const rows = () => [...container()?.querySelectorAll<HTMLElement>(".rail-row[data-id]") ?? []];

  createEffect(on(lifted, () => {
    const before = drawn;
    const reduced = matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    drawn = new Map();

    if (reduced || keyed || before.size === 0) return;

    for (const row of rows()) {
      if (!("animate" in row) || row.matches("[data-dnd-dragging], [data-dnd-dropping]")) continue;
      const was = before.get(row.dataset.id!);
      const options = { duration: reorderMs(row), easing: easingOut(row) };

      if (was === undefined) row.animate({ opacity: [0, 1] }, options);
      // A row the sortable shifted slides itself from that shift; a second translate here would double it.
      else if (!row.style.translate && Math.abs(was - row.getBoundingClientRect().top) >= 1) row.animate({ translate: [`0 ${was - row.getBoundingClientRect().top}px`, "0 0"] }, options);
    }
  }, { defer: true }));

  // A row inside a collapsed group is inert and not drawn: it returns by fading in, never by sliding from where the hidden group left it.
  return (keyboard: boolean) => { keyed = keyboard; drawn = new Map(rows().filter(row => !row.closest("[inert], [hidden]")).map(row => [row.dataset.id!, row.getBoundingClientRect().top])); };
};

export const createRailTree = (connected: ConnectedProject, unfolded: Accessor<ReadonlySet<string | null>>, rowElement: (id: string) => HTMLElement | undefined, container: Accessor<HTMLElement | undefined> = () => undefined) => {
  const { rail, now } = connected;
  /** U6550a: the row a drag holds; its children fold under it until the drop is shown. */
  const [lifted, setLifted] = createSignal<string | null>(null);
  const keepDrawn = createLiftMotion(container, lifted);
  const collapsed = rail.collapsed;
  const topology = rail.topology;
  const presentSections = createMemo(() => sections.filter(section => topology().section.includes(section.id)));

  /** U3800d: a row the move left as it was keeps its object, so the view built from it does not run again. */
  const stable = (previous: Map<string, RailRow> | undefined, row: RailRow): RailRow => {
    const kept = previous?.get(row.key);

    return kept && sameRow(kept, row) ? kept : row;
  };

  const sectionRows = createMemo<{ id: RailSection; label: string; icon: (typeof sections)[number]["icon"]; rows: RailRow[] }[]>(() => presentSections().map(section => ({
    ...section,
    rows: rail.closedSections().has(section.id) ? [] : layoutRail(topology(), { collapsed: lifted() === null ? collapsed() : new Set([...collapsed(), lifted()!]), unfolded: unfolded(), now: now(), selected: rail.selected() }, section.id),
  })));

  const rows = createMemo<RailRow[]>(previous => {
    const before = new Map(previous?.map(row => [row.key, row]));

    return sectionRows().flatMap(section => section.rows).map(row => stable(before, row));
  }, []);

  const signatures = new WeakMap<object, string>();

  /** Section branches share Ark's keyboard walk and add one semantic level above their rows. */
  const collection = createMemo<ReturnType<typeof createTreeCollection<RailNode>>>(previous => {
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

    // U3800g: a move that leaves the tree's signature as it was keeps the collection, so Ark does not recompute every row's item props.
    const signature = JSON.stringify(children);

    if (previous && signatures.get(previous) === signature) return previous;

    const next = createTreeCollection<RailNode>({
      nodeToValue: node => node.id, nodeToString: node => node.name,
      isNodeDisabled: node => Boolean(rowElement(node.id)?.closest("[hidden], [inert], [aria-disabled=true]")),
      rootNode: { id: "", name: "", children },
    });

    signatures.set(next, signature);

    return next;
  });

  const expanded = createMemo<string[]>(() => collection().getBranchValues().filter(id => {
    const section = sections.find(section => `section:${section.id}` === id);

    return section ? !rail.closedSections().has(section.id) : id.startsWith("fold:") ? unfolded().has(id.slice(5)) : !collapsed().has(id);
  }), [], { equals: sameList });

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

  // Built on the first drop asked about after a move landed: the topology is a new object whenever a node's parent changes.
  let placed: { from: ReturnType<typeof topology>; map: Map<string, { id: string; kind: ProjectNode["kind"]; parent: string | null }> } | undefined;

  const placeNodes = () => {
    if (placed?.from !== topology()) placed = { from: topology(), map: new Map(rail.nodes.map((node) => [node.id, { id: node.id, kind: node.kind, parent: node.parent }])) };

    return placed.map;
  };

  /** What a drag asks of the Rail: which rows nest a child, the Daemon's placement rule for the drops it may show (U6550c), and the fold of the row it holds. */
  const dropRules = {
    nests: (id: string) => rows().some((row) => row.kind === "node" && row.node.id === id && isWorkstream(row.node) && row.collapsed === null),
    takes: (id: string, parent: string | null) => placeable(placeNodes(), id, parent),
    onLift: (id: string | null, keyboard = false) => { keepDrawn(keyboard); setLifted(id); },
  };

  return { topology, sectionRows, rows, collection, expanded, entryOf, nodeRows, nodeIds, indexOf, treeRows, byKey, lifted, dropRules };
};

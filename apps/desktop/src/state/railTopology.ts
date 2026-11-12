import type { RailNode } from "@contracts/agent/RailNode";
import type { RailSection } from "./railStorage";

/** U5645: one revision's dense indices. Slot 0 holds roots; slot i + 1 holds node i's children.
 * The old 400-node layout read parent 160,400 times before section ancestry searches.
 * Source records stay intact; only structural fields are read while building this index. */
export const railTopology = (source: readonly RailNode[]) => {
  const nodes = [...source];
  const index = new Map(nodes.map((node, at) => [node.id, at]));
  const parents = nodes.map(node => node.parent);
  const parent = parents.map(id => id === null ? -1 : index.get(id) ?? -1);
  const order = nodes.map(node => node.order);
  const children = nodes.map((_, at) => at).sort((a, b) => parent[a]! - parent[b]! || order[a]! - order[b]!);
  const starts = Array<number>(nodes.length + 2).fill(0);

  for (const at of children) starts[parent[at]! + 2]! += 1;

  for (let at = 1; at < starts.length; at += 1) starts[at]! += starts[at - 1]!;

  const section: RailSection[] = [];

  const visit = (at: number, rootSection: RailSection) => {
    section[at] = rootSection;

    for (let child = starts[at + 1]!; child < starts[at + 2]!; child += 1) visit(children[child]!, rootSection);
  };

  for (let root = 0; root < starts[1]!; root += 1) {
    const at = children[root]!;
    const node = nodes[at]!;
    visit(at, node.kind !== "agent" ? "workstreams" : node.mode_prompt?.trim() ? "modes" : "agents");
  }

  return { nodes, index, parent, children, starts, section };
};

export type RailTopology = ReturnType<typeof railTopology>;

export const isWorkstream = (node: RailNode): boolean => node.kind === "workstream";

/** U6119: an Agent whose parent is a Workstream is the Door's to handle, so it draws no unseen marker of its own. */
export const isWorkstreamChild = (nodes: readonly RailNode[], node: RailNode): boolean =>
  node.kind === "agent" && node.parent !== null && nodes.some((each) => each.id === node.parent && isWorkstream(each));

/** U145's resolution: `selected` when it is a Workstream, else the nearest Workstream above it, else `null`. */
export const resolvedWorkstream = (nodes: readonly RailNode[], selected: string | null): string | null => {
  const node = nodes.find((candidate) => candidate.id === selected);

  if (node === undefined) return null;

  return isWorkstream(node) ? node.id : node.parent === null ? null : resolvedWorkstream(nodes, node.parent);
};

export type RailSource = readonly RailNode[] | RailTopology;

export const indexed = (source: RailSource): RailTopology => "nodes" in source ? source : railTopology(source);

export const childrenOf = (tree: RailTopology, parent: number): number[] => tree.children.slice(tree.starts[parent + 1], tree.starts[parent + 2]);

/** The children of `parent` (`null` is the top level) by `order`. */
export const siblingsOf = (source: RailSource, parent: string | null): RailNode[] => {
  const tree = indexed(source);
  const at = parent === null ? -1 : tree.index.get(parent);

  return at === undefined ? [] : childrenOf(tree, at).map(child => tree.nodes[child]!);
};

/** The ids of every node above `id`, nearest first. */
export const ancestorsOf = (source: RailSource, id: string): string[] => {
  const tree = indexed(source);
  const ids: string[] = [];
  let at = tree.index.get(id);

  while (at !== undefined && tree.parent[at] !== -1) {
    at = tree.parent[at]!;
    ids.push(tree.nodes[at]!.id);
  }

  return ids;
};

/** Every node below `id`, each parent before its children. */
export const descendantsOf = (source: RailSource, id: string): RailNode[] => {
  const tree = indexed(source);
  const result: RailNode[] = [];

  const visit = (at: number) => {
    for (const child of childrenOf(tree, at)) { result.push(tree.nodes[child]!); visit(child); }
  };

  const at = tree.index.get(id);

  if (at !== undefined) visit(at);

  return result;
};

/** Every Project node in Rail order, including children of collapsed Workstreams. */
export const railOrder = (source: RailSource): RailNode[] => {
  const tree = indexed(source);

  return siblingsOf(tree, null).flatMap(node => [node, ...descendantsOf(tree, node.id)]);
};


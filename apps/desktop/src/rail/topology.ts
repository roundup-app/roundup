import type { RailNode } from "@contracts/agent/RailNode";
import type { RailSection } from "./persist/storage";

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
    visit(at, node.kind === "agent" ? "agents" : node.opening_prompt?.trim() ? "modes" : "workstreams");
  }

  return { nodes, index, parent, children, starts, section };
};

export type RailTopology = ReturnType<typeof railTopology>;

const sameRecord = (a: RailNode, b: RailNode) => {
  if (a === b) return true;

  const other = new Map(Object.entries(b));

  return Object.keys(a).length === other.size && Object.entries(a).every(([key, value]) => other.get(key) === value);
};

/** U3800d: a redraw that leaves every Row as it was (the Daemon's answer to a move already drawn) keeps the topology it had, so nothing built from it runs again. Rows are matched by id, since the Daemon lists them in its own order. */
export const sameTopology = (before: RailTopology, after: RailTopology) =>
  before.nodes.length === after.nodes.length && after.nodes.every(node => {
    const kept = before.nodes[before.index.get(node.id) ?? -1];

    return kept !== undefined && sameRecord(kept, node);
  });

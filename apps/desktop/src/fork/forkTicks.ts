import type { RailNode } from "@contracts/agent/RailNode";
import { createMemo, createSignal } from "solid-js";
import type { ForkPick } from "../app/seam";

/** FS5979b: one row of the sheet: a Project, a Door or an Agent, in the Rail's order and nesting. */
export type ForkRow = { id: string; name: string; kind: "project" | "door" | "agent"; path: string; children: ForkRow[] };

export type ForkSource = { path: string; name: string; nodes: readonly RailNode[] };

const rowOf = (path: string, nodes: readonly RailNode[], parent: string | null): ForkRow[] =>
  nodes
    .filter(node => node.parent === parent && node.kind !== "group")
    .sort((a, b) => a.order - b.order)
    .map(node => ({ id: `${path}\n${node.id}`, name: node.name, kind: node.kind === "workstream" ? "door" : "agent", path, children: rowOf(path, nodes, node.id) }));

/** The Rail of each open Project as rows; a group folder adds no row of its own. */
export const forkRows = (sources: readonly ForkSource[]): ForkRow[] => sources.map(source => {
  const flat = source.nodes.map(node => ({ ...node, parent: groupParent(source.nodes, node) }));

  return { id: source.path, name: source.name, kind: "project", path: source.path, children: rowOf(source.path, flat, null) };
});

const groupParent = (nodes: readonly RailNode[], node: RailNode): string | null => {
  let parent = node.parent;

  while (parent !== null) {
    const above = nodes.find(each => each.id === parent);

    if (above?.kind !== "group") return parent;
    parent = above.parent;
  }

  return null;
};

const below = (row: ForkRow): ForkRow[] => row.children.flatMap(child => [child, ...below(child)]);

/** FS5979b: which rows are kept. Unticking a row unticks what is under it; ticking one ticks what is under it and the rows above it. */
export const createForkTicks = (rows: () => ForkRow[]) => {
  const all = () => rows().flatMap(row => [row, ...below(row)]);
  const [kept, setKept] = createSignal<ReadonlySet<string>>(new Set(all().map(row => row.id)));
  const parents = createMemo(() => new Map(rows().flatMap(root => [root, ...below(root)].flatMap(row => row.children.map(child => [child.id, row] as const)))));
  const byId = createMemo(() => new Map(all().map(row => [row.id, row] as const)));

  const state = (id: string): boolean | "indeterminate" => {
    const row = byId().get(id);

    if (!row || !kept().has(id)) return false;

    return below(row).every(child => kept().has(child.id)) ? true : "indeterminate";
  };

  const toggle = (id: string) => {
    const row = byId().get(id);

    if (!row) return;
    const next = new Set(kept());
    const subtree = [row, ...below(row)];

    if (state(id) === true) subtree.forEach(each => next.delete(each.id));
    else {
      subtree.forEach(each => next.add(each.id));

      for (let up = parents().get(id); up; up = parents().get(up.id)) next.add(up.id);
    }

    setKept(next);
  };

  /** FS5979d: one pick per ticked Project; `agents` is `all`, `none` or the ticked Door and Agent ids. */
  const picks = (): ForkPick[] => rows().filter(row => kept().has(row.id)).map(row => {
    const agents = below(row);
    const ticked = agents.filter(agent => kept().has(agent.id));

    return { key: row.path, agents: ticked.length === agents.length ? "all" : ticked.length === 0 ? "none" : ticked.map(agent => agent.id.slice(row.path.length + 1)) };
  });

  return { state, toggle, picks };
};

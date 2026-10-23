import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { byUrgency } from "../ink/glyph";

const DONE_FOLD_MS = 10 * 60_000;

/** U403: what a folded Workstream shows at its right: the Kinds of the Agents below it, most urgent first, whose length is the Agent count. */
export type Collapsed = { agents: readonly Kind[] };

export type RailRow =
  | { kind: "node"; key: string; depth: number; node: RailNode; collapsed: Collapsed | null; trail: readonly boolean[]; /** Rows of its own children follow it (U402): its trunk drops from its mark. */ children: boolean }
  | { kind: "fold"; key: string; depth: number; parent: string | null; count: number; trail: readonly boolean[] };

export type NodeRow = Extract<RailRow, { kind: "node" }>;

export type RailView = {
  collapsed: ReadonlySet<string>;
  /** Parents whose `✓ n done` line has been clicked open; `null` is the top level. */
  unfolded: ReadonlySet<string | null>;
  now: number;
};

export const isWorkstream = (node: RailNode): boolean => node.kind === "workstream";

/** U145's resolution: `selected` when it is a Workstream, else the nearest Workstream above it, else `null`. */
export const resolvedWorkstream = (nodes: readonly RailNode[], selected: string | null): string | null => {
  const node = nodes.find((candidate) => candidate.id === selected);

  if (node === undefined) return null;

  return isWorkstream(node) ? node.id : node.parent === null ? null : resolvedWorkstream(nodes, node.parent);
};

/** The children of `parent` (`null` is the top level) by `order`. */
export const siblingsOf = (nodes: readonly RailNode[], parent: string | null): RailNode[] =>
  nodes.filter((node) => node.parent === parent).toSorted((a, b) => a.order - b.order);

/** The ids of every node above `id`, nearest first. */
export const ancestorsOf = (nodes: readonly RailNode[], id: string): string[] => {
  const parent = nodes.find((node) => node.id === id)?.parent ?? null;

  return parent === null ? [] : [parent, ...ancestorsOf(nodes, parent)];
};

/** Every node below `id`, each parent before its children. */
export const descendantsOf = (nodes: readonly RailNode[], id: string): RailNode[] =>
  siblingsOf(nodes, id).flatMap((child) => [child, ...descendantsOf(nodes, child.id)]);

/** Every Project node in Rail order, including children of collapsed Workstreams. */
export const railOrder = (nodes: readonly RailNode[]): RailNode[] =>
  siblingsOf(nodes, null).flatMap((node) => [node, ...descendantsOf(nodes, node.id)]);

/** U403: the Kinds of the Agents below `id`, most urgent first. */
export const agentKindsBelow = (nodes: readonly RailNode[], id: string): Kind[] =>
  byUrgency(descendantsOf(nodes, id).flatMap((node) => (node.kind === "agent" && node.status ? [node.status.kind] : [])));

const isFoldedAgent = (node: RailNode, view: RailView): boolean =>
  node.kind === "agent" &&
  node.status !== null &&
  node.status.kind === "done" &&
  view.now - node.status.since >= DONE_FOLD_MS;

/** Rows in tree order: siblings by `order`, then Agents done for 10 minutes or more as one `✓ n done` line, a collapsed Workstream without its descendants. */
export const layoutRail = (nodes: readonly RailNode[], view: RailView): RailRow[] => {
  const under = (parent: string | null): RailNode[] => siblingsOf(nodes, parent);

  /** `trail[level - 1]` tells whether the connector line at `level` (U357) runs on below a row: the row's own ancestor at that depth has a later sibling row. */
  const rowsOf = (parent: string | null, depth: number, trail: readonly boolean[]): RailRow[] => {
    const siblings = under(parent);
    const folded = siblings.filter((node) => isFoldedAgent(node, view));
    const unfolded = view.unfolded.has(parent);

    const shown = [
      ...siblings.filter((node) => !folded.includes(node)),
      ...(unfolded ? folded : []),
    ];

    const foldShown = folded.length > 0 && !unfolded;

    const nodeRows = shown.flatMap((node, at): RailRow[] => {
      const rowTrail = depth === 0 ? [] : [...trail, at < shown.length - 1 || foldShown];

      const collapsed = isWorkstream(node) && view.collapsed.has(node.id);

      const below = collapsed ? [] : rowsOf(node.id, depth + 1, rowTrail);

      const row: RailRow = {
        kind: "node",
        key: `node:${node.id}`,
        depth,
        node,
        trail: rowTrail,
        children: below.length > 0,
        collapsed: collapsed ? { agents: agentKindsBelow(nodes, node.id) } : null,
      };

      return [row, ...below];
    });

    const foldRow: RailRow[] =
      foldShown
        ? [{ kind: "fold", key: `fold:${parent ?? ""}`, depth, parent, count: folded.length, trail }]
        : [];

    return [...nodeRows, ...foldRow];
  };

  return rowsOf(null, 0, []);
};

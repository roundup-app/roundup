import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import { byUrgency } from "../ink/glyph";

const IDLE_FOLD_MS = 5 * 60_000;

/** U403: what a folded Workstream shows at its right: the Kinds of the Agents below it, most urgent first, whose length is the Agent count. */
export type Collapsed = { agents: readonly Kind[] };

export type RailRow =
  | { kind: "node"; key: string; depth: number; node: RailNode; collapsed: Collapsed | null; trail: readonly boolean[]; /** Rows of its own children follow it (U402): its trunk drops from its mark. */ children: boolean }
  | { kind: "fold"; key: string; depth: number; parent: string; count: number; open: boolean; trail: readonly boolean[] };

export type NodeRow = Extract<RailRow, { kind: "node" }>;

export type RailView = {
  collapsed: ReadonlySet<string>;
  /** Workstreams whose idle branch the user opened. */
  unfolded: ReadonlySet<string | null>;
  now: number;
  protected?: ReadonlySet<string>;
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
export const agentKindsBelow = (nodes: readonly RailNode[], id: string, dismissed: (node: RailNode) => boolean = () => false): Kind[] =>
  byUrgency(descendantsOf(nodes, id).flatMap((node) => (node.kind === "agent" && node.status && !dismissed(node) ? [node.status.kind] : [])));

const isFoldedAgent = (node: RailNode, view: RailView): boolean =>
  node.kind === "agent" && node.parent !== null &&
  !view.protected?.has(node.id) && node.work?.kind !== "clarification" &&
  node.final_text?.kind === "empty" && node.final_text.attempt === node.attempt &&
  node.final_text.finished === node.status?.finished &&
  (node.status?.kind === "done" || node.status?.kind === "idle" && view.now - node.status.since >= IDLE_FOLD_MS);

/** Rows in tree order, with eligible Workstream children behind one reversible idle branch. */
export const layoutRail = (nodes: readonly RailNode[], view: RailView): RailRow[] => {
  const under = (parent: string | null): RailNode[] => siblingsOf(nodes, parent);

  /** `trail[level - 1]` tells whether the connector line at `level` (U357) runs on below a row: the row's own ancestor at that depth has a later sibling row. */
  const rowsOf = (parent: string | null, depth: number, trail: readonly boolean[]): RailRow[] => {
    const siblings = under(parent);
    const folded = siblings.filter((node) => nodes.some(each => each.id === parent && isWorkstream(each)) && isFoldedAgent(node, view));
    const unfolded = view.unfolded.has(parent);

    const shown = siblings.filter((node) => !folded.includes(node));

    const foldShown = folded.length > 0;

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

    const foldRow: RailRow[] = parent !== null && foldShown
      ? [{ kind: "fold", key: `fold:${parent}`, depth, parent, count: folded.length, open: unfolded, trail },
        ...(unfolded ? folded.map((node, at): RailRow => ({
          kind: "node", key: `node:${node.id}`, depth: depth + 1, node, collapsed: null,
          trail: [...trail, false, at < folded.length - 1], children: false,
        })) : [])]
      : [];

    return [...nodeRows, ...foldRow];
  };

  return rowsOf(null, 0, []);
};

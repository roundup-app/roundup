import type { Kind } from "@contracts/Kind";
import type { RailNode } from "@contracts/agent/RailNode";
import type { RailSection } from "../state/railStorage";
import { childrenOf, descendantsOf, indexed, isWorkstream, type RailSource } from "../state/railTopology";
import { byUrgency } from "../ink/glyph";

const IDLE_FOLD_MS = 60_000;

/** U403: what a folded Workstream shows at its right: the Kinds of the Agents below it, most urgent first, whose length is the Agent count. */
export type Collapsed = { agents: readonly Kind[] };

export type RailRow =
  | { kind: "node"; key: string; depth: number; node: RailNode; collapsed: Collapsed | null; trail: readonly boolean[]; /** Rows of its own children follow it (U402): its trunk drops from its mark. */ children: boolean }
  | { kind: "fold"; key: string; depth: number; parent: string; group: "idle" | "internal"; status: Kind; count: number; open: boolean; trail: readonly boolean[] };

export type NodeRow = Extract<RailRow, { kind: "node" }>;

export type RailView = {
  collapsed: ReadonlySet<string>;
  /** Workstreams whose idle branch the user opened. */
  unfolded: ReadonlySet<string | null>;
  now: number;
  /** U6238a: the selected row; a closed fold never holds it. */
  selected?: string | null;
};

/** U4547a: a Mode is a root Agent holding a nonblank Mode prompt. */
export const isMode = (node: RailNode): boolean => node.kind === "agent" && node.parent === null && !!node.mode_prompt?.trim();

/** U403: the Kinds of the Agents below `id`, most urgent first. */
export const agentKindsBelow = (source: RailSource, id: string, dismissed: (node: RailNode) => boolean = () => false, settled: (node: RailNode) => boolean = () => false): Kind[] =>
  byUrgency(descendantsOf(source, id).flatMap((node) => (node.kind === "agent" && node.alert_level !== "quiet" && node.status && !dismissed(node) && !settled(node) ? [node.status.kind] : [])));

const isFoldedAgent = (node: RailNode, view: RailView): boolean =>
  node.kind === "agent" &&
  (node.status?.kind === "done" || node.status?.kind === "idle" && view.now - node.status.since >= IDLE_FOLD_MS);

/** The id of the fold branch a Workstream's child belongs to, when the Workstream folds it. */
export const foldIdOf = (node: RailNode, parentId: string | null, view: RailView): string | null =>
  node.kind === "agent" && node.visibility === "internal" ? `internal:${parentId}` : isFoldedAgent(node, view) ? parentId : null;

/** Rows in tree order, with eligible Workstream children behind one reversible idle branch. */
export const layoutRail = (source: RailSource, view: RailView, section?: RailSection): RailRow[] => {
  const tree = indexed(source);

  /** The trail records which ancestor connectors continue below this row. Its output
   * may be quadratic on a chain; ancestry searches and sibling sorting are not repeated. */
  const rowsOf = (parent: number, depth: number, trail: readonly boolean[]): RailRow[] => {
    const siblings = childrenOf(tree, parent).filter(at => parent !== -1 || section === undefined || tree.section[at] === section);
    const parentId = tree.nodes[parent]?.id ?? null;
    const canFold = parent !== -1 && isWorkstream(tree.nodes[parent]!);
    const folded: number[] = [];
    const internal: number[] = [];
    const shown: number[] = [];

    for (const at of siblings) {
      const node = tree.nodes[at]!;

      const foldId = canFold ? foldIdOf(node, parentId, view) : null;
      const lifted = node.id === view.selected && !view.unfolded.has(foldId);
      const destination = foldId === null || lifted ? shown : node.visibility === "internal" ? internal : folded;

      destination.push(at);
    }

    const groups = [{ group: "internal" as const, members: internal, id: `internal:${parentId}` },
      { group: "idle" as const, members: folded, id: parentId }].filter(group => group.members.length > 0);

    const nodeRows = shown.flatMap((at, position): RailRow[] =>
      rowsOfNode(at, depth, depth === 0 ? [] : [...trail, position < shown.length - 1 || groups.length > 0]));

    const foldRows = groups.flatMap(({ group, members, id }, position): RailRow[] => {
      if (parentId === null) return [];
      const open = view.unfolded.has(id);
      const continues = position < groups.length - 1;

      return [{ kind: "fold", key: `fold:${id}`, depth, parent: parentId, group, status: group === "idle" ? "idle" : byUrgency(members.flatMap(at => tree.nodes[at]!.status ? [tree.nodes[at]!.status!.kind] : []))[0] ?? "idle", count: members.length, open, trail },
        ...(open ? members.flatMap((at, child) =>
          rowsOfNode(at, depth + 1, [...trail, continues, child < members.length - 1])) : [])];
    });

    return [...nodeRows, ...foldRows];
  };

  /** U5940a: a collapsed row counts only the children in progress, as its expanded Workstream shows them. */
  const settledChild = (node: RailNode): boolean => {
    const parent = node.parent === null ? undefined : tree.nodes[tree.index.get(node.parent) ?? -1];

    return parent !== undefined && isWorkstream(parent) && node.visibility !== "internal" && isFoldedAgent(node, view);
  };

  const rowsOfNode = (at: number, depth: number, trail: readonly boolean[]): RailRow[] => {
    const node = tree.nodes[at]!;
    const collapsed = (isWorkstream(node) || node.kind === "group") && view.collapsed.has(node.id);
    const below = collapsed ? [] : rowsOf(at, depth + 1, trail);

    const row: RailRow = {
      kind: "node", key: `node:${node.id}`, depth, node, trail,
      children: below.length > 0,
      collapsed: collapsed ? { agents: agentKindsBelow(tree, node.id, undefined, settledChild) } : null,
    };

    return [row, ...below];
  };

  return rowsOf(-1, 0, []);
};

import type { Handed } from "@contracts/todo/Handed";
import { sameOwner } from "../shelf/scope";
import type { Todo } from "@contracts/todo/Todo";
import { createTreeCollection } from "@ark-ui/solid/tree-view";
import { beforeOf } from "./beforeOf";

const byId = (a: Todo, b: Todo): number => a.id - b.id;

export const kindOf = (todo: Todo): "done" | "blocked" | "idle" => (todo.done ? "done" : todo.blocked ? "blocked" : "idle");

/** T10: the Daemon's order, never sorted here. */
export const openTodos = (all: readonly Todo[]): Todo[] => all.filter((todo) => !todo.done);

export const doneTodos = (all: readonly Todo[]): Todo[] => all.filter((todo) => todo.done);

/** Every blocker of `todo` still in the list, done or not, in id order. */
export const blockersOf = (todo: Todo, known: ReadonlyMap<number, Todo>): Todo[] =>
  todo.blockers.flatMap((id) => known.get(id) ?? []).toSorted(byId);

export const openBlockersOf = (todo: Todo, known: ReadonlyMap<number, Todo>): Todo[] =>
  blockersOf(todo, known).filter((blocker) => !blocker.done);

export const blockedBy = (todo: Todo, all: readonly Todo[]): Todo[] =>
  all.filter((other) => other.blockers.includes(todo.id)).toSorted(byId);

/** #5644's 338,120 reads for 80 Todos become one adjacency build per revision. */
export const blockerGraph = (all: readonly Todo[]) => {
  const known = new Map(all.map(todo => [todo.id, todo]));
  const forward = new Map<number, Set<number>>();
  const reverse = new Map<number, Set<number>>();

  for (const todo of all) {
    const edges = new Set(todo.blockers);
    forward.set(todo.id, edges);

    for (const id of edges) {
      const incoming = reverse.get(id) ?? new Set<number>();
      incoming.add(todo.id);
      reverse.set(id, incoming);
    }
  }

  return { all, known, forward, reverse };
};

export const blockerChoices = (todo: Todo, graph: ReturnType<typeof blockerGraph>, observe?: (kind: "vertex" | "edge" | "candidate", id: number) => void) => {
  const walk = (edges: ReadonlyMap<number, ReadonlySet<number>>) => {
    const seen = new Set<number>([todo.id]);
    const pending = [todo.id];

    while (pending.length) {
      const current = pending.pop()!;
      observe?.("vertex", current);

      for (const id of edges.get(current) ?? []) {
        observe?.("edge", id);

        if (!graph.known.has(id) || seen.has(id)) continue;
        seen.add(id);
        pending.push(id);
      }
    }

    return seen;
  };

  const ancestors = walk(graph.forward);
  const descendants = walk(graph.reverse);
  const direct = new Set(todo.blockers);
  const incoming = graph.reverse.get(todo.id) ?? new Set<number>();

  const has = (ids: ReadonlySet<number>, id: number) => {
    observe?.("candidate", id);

    return ids.has(id);
  };

  const related = (ids: ReadonlySet<number>) => [...ids].flatMap(id => graph.known.get(id) ?? []).toSorted(byId);

  return {
    blockers: related(direct),
    blocking: related(incoming),
    offeredBlockers: graph.all.filter(other => !has(descendants, other.id) && !has(direct, other.id)).toSorted(byId),
    offeredBlocking: graph.all.filter(other => !has(ancestors, other.id) && !has(incoming, other.id)),
  };
};

/** Candidates preserve id order and reject direct edges and transitive cycles. */
export const offeredAsBlockers = (todo: Todo, all: readonly Todo[]): Todo[] =>
  blockerChoices(todo, blockerGraph(all)).offeredBlockers;

/** U3708: a row of the Todos tree: its depth and the Todo it nests under, both read from `blockers` alone. */
export type NestedRow = { todo: Todo; level: number; parent: number | null };

/** U3708: the Todos of one owner list in tree order, including retained done members (U3809). A Todo nests under its first blocker in the list, directly below it among that blocker's children in the Todo order (T10); one with none is at level 1. */
export const treeRows = (list: readonly Todo[]): NestedRow[] => {
  const inList = new Map(list.map((todo) => [todo.id, todo]));
  const parentOf = (todo: Todo): number | null => todo.blockers.find((id) => inList.get(id) !== undefined && id !== todo.id) ?? null;
  const children = new Map<number | null, Todo[]>();

  for (const todo of list) {
    const parent = parentOf(todo);

    const siblings = children.get(parent) ?? [];
    siblings.push(todo);
    children.set(parent, siblings);
  }

  const seen = new Set<number>();
  const rows: NestedRow[] = [];

  const pending: NestedRow[] = [...(children.get(null) ?? [])].reverse().map(todo => ({ todo, level: 1, parent: null }));

  while (pending.length) {
    const row = pending.pop()!;

    if (seen.has(row.todo.id)) continue;
    seen.add(row.todo.id);
    rows.push(row);
    const nested = children.get(row.todo.id) ?? [];

    for (let at = nested.length - 1; at >= 0; at--) pending.push({ todo: nested[at]!, level: row.level + 1, parent: row.todo.id });
  }

  // A cycle among stale blockers leaves no root: draw what is left at level 1 rather than drop a Todo.
  for (const todo of list) if (!seen.has(todo.id)) rows.push({ todo, level: 1, parent: null });

  return rows;
};

/** U3710: what a drop of `id` under `parent` at `index` among that parent's other children changes: its new `blockers` (absent when its depth is kept) and the `before` of a `todo.reorder` (absent when its place is kept). */
export type DropPlan = { blockers?: number[]; before?: number | null };

/** `flat` is the list's open Todos in the Daemon's order (T10); `all` is every Todo, as `beforeOf` reads it. */
export const planDrop = (rows: readonly NestedRow[], flat: readonly Todo[], all: readonly Todo[], id: number, parent: number | null, index: number): DropPlan => {
  const own = rows.find((row) => row.todo.id === id);

  if (!own) return {};

  const moving = new Set([id]);

  for (const row of rows) if (row.parent !== null && moving.has(row.parent)) moving.add(row.todo.id);

  if (parent !== null && (moving.has(parent) || !offeredAsBlockers({ ...own.todo, blockers: [] }, all).some(todo => todo.id === parent) && parent !== own.parent)) return {};

  const remaining = rows.filter((row) => !moving.has(row.todo.id));
  const level = parent === null ? 1 : (remaining.find((row) => row.todo.id === parent)?.level ?? 0) + 1;
  const plan: DropPlan = {};

  if (parent !== own.parent) {
    const others = own.todo.blockers.filter((blocker) => blocker !== parent && (level > own.level || blocker !== own.parent));

    plan.blockers = parent === null ? others : [parent, ...others];
  }

  const siblings = remaining.filter((row) => row.parent === parent);
  const anchor = siblings.at(-1) ?? remaining.find((row) => row.todo.id === parent);
  const next = siblings[index]?.todo.id ?? (anchor === undefined ? undefined : remaining.slice(remaining.indexOf(anchor) + 1).find((row) => row.level <= anchor.level)?.todo.id);
  const order = remaining.map((row) => row.todo.id);
  const to = next === undefined ? order.length : order.indexOf(next);
  const before = beforeOf(all, order, id, to);
  const alone = flat.flatMap((todo) => (!moving.has(todo.id) || todo.id === id ? [todo.id] : []));

  if (before !== beforeOf(all, alone, id, alone.indexOf(id))) plan.before = before;

  return plan;
};

/** Preorder columns: subtree end is exclusive; firstChild/nextSibling enumerate only immediate children. */
export const rowTopology = (rows: readonly NestedRow[]) => {
  const index = new Map<number, number>();
  const parent: (number | null)[] = [];
  const end = Array<number>(rows.length).fill(rows.length);
  const firstChild: (number | null)[] = Array(rows.length).fill(null);
  const nextSibling: (number | null)[] = Array(rows.length).fill(null);
  const last = new Map<number | null, number>();
  const stack: number[] = [];
  let root: number | null = null;
  rows.forEach((row, at) => {
    while (stack.length && rows[stack.at(-1)!]!.level >= row.level) end[stack.pop()!] = at;
    const above = row.parent === null ? null : index.get(row.parent) ?? null;
    parent.push(above);
    const previous = last.get(above);

    if (previous !== undefined) nextSibling[previous] = at;
    else if (above === null) root = at;
    else firstChild[above] = at;
    last.set(above, at);
    index.set(row.todo.id, at);
    stack.push(at);
  });

  const children = (id: number | null): NestedRow[] => {
    const result: NestedRow[] = [];

    for (let at = id === null ? root : firstChild[index.get(id)!]; at != null; at = nextSibling[at]) result.push(rows[at]!);

    return result;
  };

  return { rows, index, parent, end, firstChild, nextSibling, root, children };
};

type TreeNode = { id: string; children: TreeNode[] };

/** Ark owns the keyboard semantics; application construction visits each child slot once. */
export const treeCollection = (topology: ReturnType<typeof rowTopology>) => {
  const root: TreeNode = { id: "root", children: [] };
  const nodes = topology.rows.map((row): TreeNode => ({ id: String(row.todo.id), children: [] }));
  nodes.forEach((node, at) => {
    const parent = topology.parent[at];
    (parent == null ? root : nodes[parent]!).children.push(node);
  });

  return createTreeCollection<TreeNode>({ nodeToValue: node => node.id, nodeToString: node => node.id, rootNode: root });
};

/** U3808: the latest eligible Handed Todo of each live Agent. */
export const nowTodos = (list: readonly Todo[], handed: readonly Handed[], agents: ReadonlySet<string>): Set<number> => {
    const latest = new Map<string, { id: number; seq: number }>();

    for (const fact of handed) {
      const todo = list.find(todo => todo.id === fact.todo);

      if (!todo || todo.done || todo.blocked || todo.owner?.kind !== "agent" || !sameOwner(todo.owner, fact.owner)) continue;

      if (!agents.has(todo.owner.id)) continue;
      const previous = latest.get(todo.owner.id);

      if (!previous || fact.seq > previous.seq) latest.set(todo.owner.id, { id: todo.id, seq: fact.seq });
    }

    return new Set([...latest.values()].map(fact => fact.id));
};

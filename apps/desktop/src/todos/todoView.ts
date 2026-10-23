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

/** Todos that can wait on `todo`: not itself, not already a blocker, and none that already waits on it, directly or through others. */
export const offeredAsBlockers = (todo: Todo, all: readonly Todo[]): Todo[] => {
  const byKnown = new Map(all.map((other) => [other.id, other]));

  const waitsOnTodo = (other: Todo, seen = new Set<number>()): boolean => {
    if (other.blockers.includes(todo.id)) return true;
    seen.add(other.id);

    return other.blockers.some((id) => {
      const next = byKnown.get(id);

      return next !== undefined && !seen.has(id) && waitsOnTodo(next, seen);
    });
  };

  return all.filter((other) => other.id !== todo.id && !todo.blockers.includes(other.id) && !waitsOnTodo(other)).toSorted(byId);
};

/** U3708: a row of the Todos tree: its depth and the Todo it nests under, both read from `blockers` alone. */
export type NestedRow = { todo: Todo; level: number; parent: number | null };

/** U3708: the Todos of one owner list in tree order, including retained done members (U3809). A Todo nests under its first blocker in the list, directly below it among that blocker's children in the Todo order (T10); one with none is at level 1. */
export const treeRows = (list: readonly Todo[]): NestedRow[] => {
  const inList = new Map(list.map((todo) => [todo.id, todo]));
  const parentOf = (todo: Todo): number | null => todo.blockers.find((id) => inList.get(id) !== undefined && id !== todo.id) ?? null;
  const children = new Map<number | null, Todo[]>();

  for (const todo of list) {
    const parent = parentOf(todo);

    children.set(parent, [...(children.get(parent) ?? []), todo]);
  }

  const seen = new Set<number>();
  const rows: NestedRow[] = [];

  const walk = (parent: number | null, level: number) => {
    for (const todo of children.get(parent) ?? []) {
      if (seen.has(todo.id)) continue;
      seen.add(todo.id);
      rows.push({ todo, level, parent });
      walk(todo.id, level + 1);
    }
  };

  walk(null, 1);

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

type TreeNode = { id: string; children?: TreeNode[] };

/** The rows as the TreeView's collection: each row's children are the rows naming it as parent. */
export const treeCollection = (rows: readonly NestedRow[]) => {
  const children = (parent: number | null): TreeNode[] =>
    rows.flatMap((row) => (row.parent === parent ? [{ id: String(row.todo.id), children: children(row.todo.id) }] : []));

  return createTreeCollection<TreeNode>({
    nodeToValue: (node) => node.id,
    nodeToString: (node) => node.id,
    rootNode: { id: "root", children: children(null) },
  });
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

/** U138: the row to focus once a completed Todo leaves the open list — the next one, else the previous, else none (the `+` button). */
export const rowAfter = (id: number, openIds: readonly number[]): number | null => {
  const at = openIds.indexOf(id);

  return openIds[at + 1] ?? openIds[at - 1] ?? null;
};


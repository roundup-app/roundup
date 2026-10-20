import type { Todo } from "@contracts/todo/Todo";

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

export const offeredAsBlockers = (todo: Todo, all: readonly Todo[]): Todo[] =>
  all.filter((other) => other.id !== todo.id && !todo.blockers.includes(other.id)).toSorted(byId);

/** U3708: a row of the Todos tree: its depth and the Todo it nests under, both read from `blockers` alone. */
export type NestedRow = { todo: Todo; level: number; parent: number | null };

/** U3708: the open Todos of one list in tree order. A Todo nests under its first open blocker in the list, directly below it among that blocker's children in the Todo order (T10); one with none is at level 1. */
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

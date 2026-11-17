import type { Todo } from "@contracts/todo/Todo";
import { durationMs, easingOut } from "../ui/reorderMotion";

/** U156: the layout animation of a row that changed place, the one U53 gives a row below a completed one, timed by the `--duration-todo` and `--easing-out` Tokens that the CSS fold uses too. */
export const slideOf = (): KeyframeAnimationOptions => {
  return { duration: durationMs("--duration-todo"), easing: easingOut() };
};

/** U155: `todo.reorder`'s `before` for putting `id` at index `to` of the list `listIds`: the next row of the list, else the Todo after the list's last row in `all`, else null. */
export const beforeOf = (all: readonly Todo[], listIds: readonly number[], id: number, to: number): number | null => {
  const others = listIds.filter((other) => other !== id);
  const next = others[to];

  if (next !== undefined) return next;

  const last = others.at(-1);
  const rest = all.filter((todo) => todo.id !== id);

  return (last === undefined ? undefined : rest[rest.findIndex((todo) => todo.id === last) + 1])?.id ?? null;
};

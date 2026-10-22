import type { Todo } from "@contracts/todo/Todo";

/** U156: the layout animation of a row that changed place, the one U53 gives a row below a completed one, timed by the `--duration-todo` and `--easing-out` Tokens that the CSS fold uses too. */
export const slideOf = (): KeyframeAnimationOptions => {
  const style = getComputedStyle(document.documentElement);
  const duration = style.getPropertyValue("--duration-todo").trim();

  return { duration: parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000), easing: style.getPropertyValue("--easing-out").trim() };
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

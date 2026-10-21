import type { Actor } from "@contracts/Actor";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";

/** The Pads `agent` owns, in `pad.list` order. */
export const padsOwnedBy = (pads: readonly Pad[], agent: Actor["id"]): Pad[] =>
  pads.filter((pad) => pad.owner.kind === "agent" && pad.owner.id === agent);

/** The Todos `agent` created, in the Daemon's order (T10). */
export const todosCreatedBy = (todos: readonly Todo[], agent: Actor["id"]): Todo[] =>
  todos.filter((todo) => todo.creator.kind === "agent" && todo.creator.id === agent);

import type { Actor } from "@contracts/Actor";
import type { Todo } from "@contracts/todo/Todo";

/** The Todos `agent` created, in the Daemon's order (T10). */
export const todosCreatedBy = (todos: readonly Todo[], agent: Actor["id"]): Todo[] =>
  todos.filter((todo) => todo.creator.kind === "agent" && todo.creator.id === agent);

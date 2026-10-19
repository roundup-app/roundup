import { createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";

import type { ConnectedProject } from "../state/connectedProject";
import { shelfScope } from "../shelf/scope";
import type { TodosState } from "./state";
import { openTodos } from "./todoView";

/** U2744a: the open membership used by the Shelf and its window-bar count. */
export const shownTodos = (connected: ConnectedProject, todos: TodosState): Accessor<Todo[]> => {
  const scope = shelfScope(connected);

  return createMemo(() => openTodos(todos.all()).filter(todo => scope.includes(todo.home, todo.creator)));
};

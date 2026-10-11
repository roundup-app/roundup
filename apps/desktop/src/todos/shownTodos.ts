import { createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { isTodoOnRail } from "../rail/pads/owned";
import type { ConnectedProject } from "../state/connectedProject";
import { useShelfScope } from "./shelfScope";
import type { TodosState } from "./state";
import { openTodos } from "./todoView";

/** U15, U60, U159, U347: the open Todos the Shelf lists, which its tab counts; `this one` lists every open Todo of the Workstream, `all` leaves out those that show under their Agent. */
export const shownTodos = (connected: ConnectedProject, todos: TodosState): Accessor<Todo[]> => {
  const scope = useShelfScope(connected);

  return createMemo(() => {
    const workstream = scope.workstream();

    return workstream !== null && !scope.showAll()
      ? openTodos(todos.all()).filter((todo) => todo.home === workstream)
      : openTodos(todos.all()).filter((todo) => !isTodoOnRail(todo, connected.rail.nodes));
  });
};

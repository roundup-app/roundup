import { copy } from "../copy";
import { createMemo, deep, Show } from "solid-js";
import { IconButton } from "../../ui/IconButton";
import { useConnectedProject } from "../../state/connectedProject";
import { useTodoList } from "../../todos/todoList";
import { ownKeys } from "../rows";

/** U5645b: one pass over the shared list, independent of how many Agent rows mount. U7488c: each Agent's Todos as done and total. */
export const createAgentPads = () => {
  const todos = useTodoList();

  const counts = createMemo(() => {
    const byCreator = new Map<string, { done: number; total: number }>();

    for (const todo of todos.all()) {
      // The shared list reconciles records in place: completion is also a Todo revision, and a Solid 2 key read tracks only which keys a record has, so `deep` follows every value.
      deep(todo);
      const creator = todo.creator;

      if (creator.kind !== "agent") continue;

      const tally = byCreator.get(creator.id) ?? { done: 0, total: 0 };

      tally.total += 1;

      if (todo.done) tally.done += 1;

      byCreator.set(creator.id, tally);
    }

    return byCreator;
  });

  return (agent: string) => counts().get(agent) ?? { done: 0, total: 0 };
};

/** An empty `title` ends the row's native name at this control, which keeps its own tooltip (U2228a); the count is visible, so U7488c gives it none. */
const NO_NATIVE_TITLE = { title: "" };

/** U7488c: a ring that fills as an Agent's Todos finish, with no count text, its `done/total` in the control's name; absent at 0 Todos. U4457: it opens the Shelf on the Todos the Agent created. The ring is a plain 12 px SVG (ui-sdk's Progress root renders a wide grid), filled with `--accent` over `--progress-track`. */
export const PadsControl = (props: { todos: { done: number; total: number }; agent: string }) => {
  const connected = useConnectedProject();
  const name = () => copy.todoProgress(props.todos.done, props.todos.total);

  return (
    <Show when={props.todos.total > 0}>
      <IconButton
        {...ownKeys}
        class="rail-pads-control"
        data-pads-control
        {...NO_NATIVE_TITLE}
        aria-label={name()}
        onClick={click => { click.stopPropagation(); connected.showPadsOf(props.agent, "todos"); }}
      >
        <svg class="todo-ring" viewBox="0 0 16 16" role="progressbar" aria-label={name()} aria-valuemin={0} aria-valuemax={props.todos.total} aria-valuenow={props.todos.done} style={{ "--ring-ratio": props.todos.done / props.todos.total }}>
          <circle class="todo-ring-track" cx="8" cy="8" r="7" pathLength="1" />
          <circle class="todo-ring-fill" cx="8" cy="8" r="7" pathLength="1" />
        </svg>
      </IconButton>
    </Show>
  );
};

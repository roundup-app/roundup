import { copy } from "../copy";
import { createMemo, Show } from "solid-js";
import { Icon } from "../../ink/Icon";
import { IconButton } from "../../ui/IconButton";
import { useConnectedProject } from "../../state/connectedProject";
import { useTodoList } from "../../todos/todoList";
import { ownKeys } from "../rows";

/** U5645b: one pass over the shared list, independent of how many Agent rows mount. */
export const createAgentPads = () => {
  const todos = useTodoList();

  const counts = createMemo(() => {
    const byCreator = new Map<string, number>();

    for (const todo of todos.all()) {
      // The shared list reconciles records in place: completion is also a Todo revision.
      Object.keys(todo);
      const creator = todo.creator;

      if (creator.kind === "agent") byCreator.set(creator.id, (byCreator.get(creator.id) ?? 0) + 1);
    }

    return byCreator;
  });

  return (agent: string) => counts().get(agent) ?? 0;
};

/** An empty `title` ends the row's native name at this control, which keeps its own tooltip (U2228a). */
const NO_NATIVE_TITLE = { title: "" };

/** `◇<n>` at the right end of an Agent's row; absent at 0. U4457: it opens the Shelf on the Todos the Agent created. */
export const PadsControl = (props: { count: number; agent: string }) => {
  const connected = useConnectedProject();
  const name = () => copy.todoCount(props.count);

  return (
    <Show when={props.count > 0}>
      <IconButton
        {...ownKeys}
        class="rail-pads-control"
        data-pads-control
        {...NO_NATIVE_TITLE}
        aria-label={name()}
        onClick={click => { click.stopPropagation(); connected.showPadsOf(props.agent, "todos"); }}
      ><Icon name="diamond" /></IconButton>
    </Show>
  );
};

import { copy } from "../../copy";
import { createMemo, Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { Icon } from "../../ink/Icon";
import { IconButton } from "../../ui/IconButton";
import { useConnectedProject } from "../../state/connectedProject";
import { useTodoList } from "../../todos/todoList";
import { ownKeys } from "../rows";
import { todosCreatedBy, padsOwnedBy } from "./owned";
import { usePadList } from "./padList";

/** The count behind one Rail row's Pads control (U58, U60): how many Pads its Agent owns and Todos it created (0 for any other row). */
export const createAgentPads = (node: Accessor<RailNode>) => {
  const all = usePadList().pads;
  const todos = useTodoList();
  const owned = createMemo(() => (node().kind === "agent" ? padsOwnedBy(all(), node().id) : []));
  const ownedTodos = createMemo(() => (node().kind === "agent" ? todosCreatedBy(todos.all(), node().id) : []));

  return { owned, ownedTodos, n: () => owned().length + ownedTodos().length };
};

export type AgentPads = ReturnType<typeof createAgentPads>;

/** U178: the control is named by what it holds. */
const controlName = (pads: number, todos: number): string =>
  todos === 0 ? copy.padCount(pads) : pads === 0 ? copy.todoCount(todos) : copy.padsAndTodos(pads + todos);

/** An empty `title` ends the row's native name at this control, which keeps its own tooltip (U2228a). */
const NO_NATIVE_TITLE = { title: "" };

/** `◇<n>` at the right end of an Agent's row; absent at 0. U4457: it opens the Shelf on the Agent's Pads group. */
export const PadsControl = (props: { pads: AgentPads; agent: string }) => {
  const connected = useConnectedProject();
  const name = () => controlName(props.pads.owned().length, props.pads.ownedTodos().length);

  return (
    <Show when={props.pads.n() > 0}>
      <IconButton
        {...ownKeys}
        class="rail-pads-control"
        data-pads-control
        {...NO_NATIVE_TITLE}
        aria-label={name()}
        onClick={click => { click.stopPropagation(); connected.showPadsOf(props.agent); }}
      ><Icon name="diamond" /></IconButton>
    </Show>
  );
};

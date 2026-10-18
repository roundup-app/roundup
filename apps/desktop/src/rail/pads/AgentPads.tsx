import { copy } from "../../copy";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Accessor } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { ErrorLine } from "../../ink/ErrorLine";
import { Icon } from "../../ink/Icon";
import { PadDrawer } from "../../pads/PadDrawer";
import { cutName } from "../../pads/nameLine";
import { useConnectedProject } from "../../state/connectedProject";
import { OpenRow } from "../../todos/Todos";
import { failureOf } from "../../todos/failureOf";
import { TodoDrawer } from "../../todos/TodoDrawer";
import { createSortedList } from "../../todos/sortedList";
import { Sortable } from "../../ui/sortable";
import { useTodoList } from "../../todos/todoList";
import { ownKeys } from "../rows";
import { Tip } from "../Tip";
import { Trunks } from "../Trunks";
import { openTodosBy, padsOwnedBy } from "./owned";
import { usePadList } from "./padList";

/** The Pads and open Todos under one Rail row (U58, U60): `n` is how many its Agent owns and created together (0 for any other row), `shown` is whether the control is open. */
export const createAgentPads = (node: Accessor<RailNode>) => {
  const all = usePadList().pads;
  const todos = useTodoList();
  const [shown, setShown] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const owned = createMemo(() => (node().kind === "agent" ? padsOwnedBy(all(), node().id) : []));
  const ownedTodos = createMemo(() => (node().kind === "agent" ? openTodosBy(todos.all(), node().id) : []));
  const connected = useConnectedProject();

  const reorder = createSortedList({
    ids: () => ownedTodos().map((todo) => todo.id),
    all: todos.all,
    call: (params) => failureOf(() => connected.app.rpc("todo.reorder", params)),
    reducedMotion: connected.reducedMotion,
  });

  const count = () => owned().length + ownedTodos().length;

  return {
    all,
    owned,
    todos,
    ownedTodos,
    reorder,
    n: count,
    shown: () => shown() && count() > 0,
    toggle: () => setShown((open) => !open),
    failure,
    setFailure,
  };
};

export type AgentPads = ReturnType<typeof createAgentPads>;

/** U178: the control is named by what it holds. */
const controlName = (pads: number, todos: number): string =>
  todos === 0 ? copy.padCount(pads) : pads === 0 ? copy.todoCount(todos) : copy.padsAndTodos(pads + todos);

/** `◇<n>` at the right end of an Agent's row; absent at 0. */
export const PadsControl = (props: { pads: AgentPads }) => {
  const name = () => controlName(props.pads.owned().length, props.pads.ownedTodos().length);

  return (
    <Show when={props.pads.n() > 0}>
      <Tip text={name()}>
        {(trigger) => (
          <button
            {...trigger({
              ...ownKeys,
              onClick: (click: MouseEvent) => {
                click.stopPropagation();
                props.pads.toggle();
              },
            })}
            type="button"
            data-button="row-action"
            class="word rail-pads-control"
            data-pads-control
            aria-label={name()}
            aria-expanded={props.pads.shown()}
          >
            <Icon name="diamond" />{props.pads.n()}
          </button>
        )}
      </Tip>
    </Show>
  );
};

/** U405: one leaf hanging on the Agent's trunk, one `--rail-step` under its Glyph; `last` ends the trunk at its elbow. */
const Leaf = (props: { depth: number; trail: readonly boolean[]; last: boolean; todo?: boolean; children: JSX.Element }) => (
  <div
    class="rail-leaf"
    data-leaf={props.todo ? "todo" : "pad"}
    style={{ "--indent": `calc(${props.depth + 1} * var(--rail-step) + var(--rail-inset))` }}
  >
    <Trunks depth={props.depth + 1} trail={[...props.trail, !props.last]} stem={false} />
    {props.children}
  </div>
);

/** The Pad leaves, then the open Todo leaves, one level below `depth`, folded at rest; a click opens a Pad's Drawer as the Shelf's list does (U20). Opening changes no selection (U64). `children` tells that the Agent's own child rows follow, so the last leaf's trunk runs on. */
export const PadRows = (props: { pads: AgentPads; depth: number; trail: readonly boolean[]; children: boolean }) => {
  const connected = useConnectedProject();

  const openPad = (name: string, event: MouseEvent) => {
    props.pads.setFailure(null);
    connected.drawer.open(() => <PadDrawer name={name} pads={props.pads.all} onLateFailure={props.pads.setFailure} />, event.detail === 0 ? "key" : "pointer");
  };

  const leaves = () => props.pads.owned().length + props.pads.ownedTodos().length;
  const last = (at: number) => at === leaves() - 1 && !props.children;

  return (
    <>
      <Show when={props.pads.shown()}>
        <Sortable.Root
          class="rail-leaves"
          data-pads
          role="group"
          plain
          ids={props.pads.ownedTodos().map((todo) => String(todo.id))}
          onOrderChange={props.pads.reorder.order}
        >
          <For each={props.pads.owned()}>
            {(pad, at) => (
              <Leaf depth={props.depth} trail={props.trail} last={last(at())}>
                <Tip text={pad.name}>
                  {(trigger) => (
                    <button
                      {...trigger({
                        onClick: (event) => openPad(pad.name, event),
                      })}
                      type="button"
                      data-button="quiet"
                      class="rail-pad"
                    >
                      <Icon name="diamond" />
                      <span style={cutName}>{pad.name}</span>
                    </button>
                  )}
                </Tip>
              </Leaf>
            )}
          </For>
          <For each={props.pads.ownedTodos()}>
            {(todo, at) => (
              <Sortable.Item id={String(todo.id)} index={at()} pressable>
                {(parts) => {
                  const sorted = props.pads.reorder.row(todo.id, parts);

                  return (
                    <Leaf depth={props.depth} trail={props.trail} last={last(props.pads.owned().length + at())} todo>
                      <OpenRow
                        nested
                        todo={todo}
                        known={props.pads.todos.byId()}
                        onOpen={(opened, source) => connected.drawer.open(() => <TodoDrawer id={opened.id} todos={props.pads.todos} />, source)}
                        sorted={sorted}
                        onComplete={(done) => failureOf(() => connected.app.rpc("todo.complete", { id: done.id }))}
                      />
                    </Leaf>
                  );
                }}
              </Sortable.Item>
            )}
          </For>
        </Sortable.Root>
      </Show>
      <Show when={props.pads.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
    </>
  );
};

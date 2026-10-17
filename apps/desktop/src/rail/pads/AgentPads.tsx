import { copy } from "../../copy";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Accessor } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { ErrorLine } from "../../ink/ErrorLine";
import { Icon } from "../../ink/Icon";
import { PadDrawer } from "../../pads/PadDrawer";
import { cutName } from "../../pads/nameLine";
import { useConnectedProject } from "../../state/connectedProject";
import { OpenRow } from "../../todos/Todos";
import type { SortedRow } from "../../todos/Todos";
import { failureOf } from "../../todos/failureOf";
import { TodoDrawer } from "../../todos/TodoDrawer";
import { beforeOf, REORDER_EASING, REORDER_MS } from "../../todos/beforeOf";
import { Sortable } from "../../ui";
import { useTodoList } from "../../todos/todoList";
import { Trunks } from "../Trunks";
import { openTodosBy, padsOwnedBy } from "./owned";
import { usePadList } from "./padList";

type SortableParts = Parameters<Parameters<typeof Sortable.Item>[0]["children"]>[0];

/** The Pads and open Todos under one Rail row (U58, U60): `n` is how many its Agent owns and created together (0 for any other row), `shown` is whether the control is open. */
export const createAgentPads = (node: Accessor<RailNode>) => {
  const all = usePadList().pads;
  const todos = useTodoList();
  const [shown, setShown] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const owned = createMemo(() => (node().kind === "agent" ? padsOwnedBy(all(), node().id) : []));
  const ownedTodos = createMemo(() => (node().kind === "agent" ? openTodosBy(todos.all(), node().id) : []));
  const connected = useConnectedProject();

  const frames = new Map<number, HTMLElement>();
  const buttons = new Map<number, HTMLButtonElement>();
  const fails = new Map<number, (message: string | null) => void>();
  const tops = new Map<number, number>();
  let refocus: number | null = null;

  /** U156: slides each row from where it showed to where the refetched list puts it. */
  const settle = () => {
    for (const [id, el] of frames) {
      const top = el.offsetTop;
      const was = tops.get(id);

      tops.set(id, top);

      if (was === undefined || connected.reducedMotion() || !("animate" in el) || Math.abs(was - top) < 1) continue;
      el.getAnimations().forEach((animation) => animation.cancel());
      el.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], { duration: REORDER_MS, easing: REORDER_EASING });
    }

    if (refocus !== null) buttons.get(refocus)?.focus();

    refocus = null;
  };

  createEffect(on(() => ownedTodos().map((todo) => todo.id), settle, { defer: true }));

  /** U490a: one `todo.reorder` putting `id` at index `to` of this Agent's list. */
  const move = async (id: number, to: number) => {
    const message = await failureOf(() => connected.app.rpc("todo.reorder", { id, before: beforeOf(todos.all(), ownedTodos().map((todo) => todo.id), id, to) }));

    fails.get(id)?.(message);

    if (message !== null) {
      refocus = null;
      buttons.get(id)?.focus();
    }
  };

  const reorder = {
    /** The Sortable's new order of the ids: the row it moved goes to its index. */
    order: (next: readonly string[]) => {
      const before = ownedTodos().map((todo) => String(todo.id));
      const at = next.findIndex((id, index) => id !== before[index]);
      const moved = [next[at], before[at]].find((id) => id !== undefined && before.filter((other) => other !== id).join() === next.filter((other) => other !== id).join());

      if (moved === undefined) return;
      refocus = Number(moved);
      void move(refocus, next.indexOf(moved));
    },
    row: (id: number, parts: SortableParts): SortedRow => ({
      frame: (el) => {
        if (el) {
          frames.set(id, el);
          parts.ref(el);
        } else {
          frames.delete(id);
          tops.delete(id);
        }
      },
      button: (el) => {
        if (el) buttons.set(id, el);
        else {
          buttons.delete(id);
          fails.delete(id);
        }

        parts.handleRef(el ?? undefined);
      },
      fail: (show) => fails.set(id, show),
      key: (event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;

        event.preventDefault();

        const to = ownedTodos().findIndex((todo) => todo.id === id) + (event.key === "ArrowUp" ? -1 : 1);

        if (to < 0 || to >= ownedTodos().length) return;
        frames.forEach((el, other) => tops.set(other, el.offsetTop));
        refocus = id;
        void move(id, to);
      },
    }),
  };

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
export const PadsControl = (props: { pads: AgentPads }) => (
  <Show when={props.pads.n() > 0}>
    <button data-button="row-action"
      class="word rail-pads-control"
      data-pads-control
      aria-label={controlName(props.pads.owned().length, props.pads.ownedTodos().length)}
      title={controlName(props.pads.owned().length, props.pads.ownedTodos().length)}
      aria-expanded={props.pads.shown()}
      onClick={(click) => {
        click.stopPropagation();
        props.pads.toggle();
      }}
    >
      <Icon name="diamond" />{props.pads.n()}
    </button>
  </Show>
);

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
                <button data-button="quiet"
                  type="button"
                  class="rail-pad"
                  title={pad.name}
                  onClick={() => {
                    props.pads.setFailure(null);
                    connected.drawer.open(() => (
                      <PadDrawer name={pad.name} pads={props.pads.all} onLateFailure={props.pads.setFailure} />
                    ));
                  }}
                >
                  <Icon name="diamond" />
                  <span style={cutName}>{pad.name}</span>
                </button>
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
                        onOpen={(opened) => connected.drawer.open(() => <TodoDrawer id={opened.id} todos={props.pads.todos} />)}
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

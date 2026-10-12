import { Icon } from "../ink/Icon";
import type { JSX } from "solid-js";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { ErrorLine } from "../ink/ErrorLine";
import { ShelfRow } from "../ink/ShelfRow";
import { KindGlyph } from "../ink/KindGlyph";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "./failureOf";
import { RowButton } from "./RowButton";
import { createReorder } from "./reorder";
import type { Reorder } from "./reorder";
import { useShelfScope } from "./shelfScope";
import { useTodoList } from "./todoList";
import { TodoDrawer } from "./TodoDrawer";
import { ScopeControl } from "../shelf/ScopeControl";
import { shownTodos } from "./shownTodos";
import { doneTodos, kindOf, openBlockersOf } from "./todoView";

/** U138: the row to focus once a completed Todo leaves the open list — the next one, else the previous, else none (the `+` button). */
export const rowAfter = (id: number, openIds: readonly number[]): number | null => {
  const at = openIds.indexOf(id);

  return openIds[at + 1] ?? openIds[at - 1] ?? null;
};

/** U361: the tick box that completes a Todo, drawn in the Glyph's place but placed after the row button in the tab order. */
const TickBox = (props: { title: string; done?: boolean; onChange?: (box: HTMLInputElement) => void }) => (
  <label class="todo-tick">
    <input
      type="checkbox"
      aria-label={`complete ${props.title}`}
      checked={props.done === true}
      disabled={props.done === true}
      onChange={(event) => props.onChange?.(event.currentTarget)}
    />
  </label>
);

/** One open Todo as U15 draws it, with U35's `complete` and `waits on`; `nested` is the Rail's copy (U60), which leaves `data-id` to the Agent rows. */
export const OpenRow = (props: {
  nested?: boolean;
  /** U153: the row whose Drawer is open. */
  selected?: boolean;
  todo: Todo;
  known: ReadonlyMap<number, Todo>;
  onOpen: (todo: Todo) => void;
  onComplete: (todo: Todo) => Promise<string | null>;
  registerRow?: (id: number, row: HTMLButtonElement | null) => void;
  /** U155: the list this row moves in. */
  reorder?: Reorder;
}) => {
  const connected = useConnectedProject();
  const waitingOn = createMemo(() => openBlockersOf(props.todo, props.known));
  const [failure, setFailure] = createSignal<string | null>(null);

  // Matches U9's rule: a failure clears on the next click anywhere, not only inside its own row.
  onMount(() => {
    const clear = () => setFailure(null);

    document.addEventListener("click", clear);
    onCleanup(() => document.removeEventListener("click", clear));
  });

  onCleanup(() => {
    props.registerRow?.(props.todo.id, null);
    props.reorder?.frame(props.todo.id, null);
    props.reorder?.button(props.todo.id, null);
  });

  return (
    <ShelfRow
      glyph={null}
      data-id={props.nested ? undefined : props.todo.id}
      data-todo={props.todo.id}
      data-shelf-row={props.nested ? undefined : ""}
      data-selected={props.selected ? "true" : undefined}
      class="todo-row"
      ref={(frame) => props.reorder?.frame(props.todo.id, frame)}
    >
      <div class="row-head">
        <RowButton
          hang={false}
          label={`${kindOf(props.todo)} #${props.todo.id} ${props.todo.title}`}
          onClick={() => props.onOpen(props.todo)}
          reorderable={props.reorder !== undefined}
          onKeyDown={(event) => props.reorder?.key(props.todo.id, event, setFailure)}
          onPointerDown={(event) => props.reorder?.press(props.todo.id, event, setFailure)}
          ref={(row) => {
            props.registerRow?.(props.todo.id, row);
            props.reorder?.button(props.todo.id, row);
          }}
        >
          <span class="shelf-title" title={props.todo.title}>{props.todo.title}</span>
        </RowButton>
      </div>
      <Show when={props.todo.body.trim() !== ""}>
        <p class="item-description" data-todo-description>{props.todo.body.trim()}</p>
      </Show>
      <Show when={failure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={props.todo.blocked}>
        <p class="shelf-meta" data-todo-meta>
          <KindGlyph kind="blocked" />
          <Show when={failure() === null && waitingOn().length > 0}>
            {" "}
            <span data-todo-waits title={`waits on ${waitingOn().map((blocker) => blocker.title).join(", ")}`}>
              waits on <For each={waitingOn()}>{(blocker, index) => (
                <>
                  <Show when={index() > 0}>{", "}</Show>
                  <button data-button="quiet" type="button" class="word" aria-label={`open blocker ${blocker.title}`} onClick={() => props.onOpen(blocker)}>
                    {blocker.title}
                  </button>
                </>
              )}</For>
            </span>
          </Show>
        </p>
      </Show>
      <TickBox
        title={props.todo.title}
        onChange={async (box) => {
          const message = await props.onComplete(props.todo);

          setFailure(message);
          if (message !== null) box.checked = false;
        }}
      />
    </ShelfRow>
  );
};

/** The Shelf's `todos` list: open Todos in id order, done ones folded, and the inline field that makes a new one. */
export const Todos = () => {
  const connected = useConnectedProject();
  const todos = useTodoList();
  const [typing, setTyping] = createSignal(false);
  const [createFailure, setCreateFailure] = createSignal<string | null>(null);
  const [unfolded, setUnfolded] = createSignal(false);
  const scope = useShelfScope(connected);
  const selectedWorkstream = scope.workstream;
  const thisWorkstream = createMemo(() => selectedWorkstream() !== null && !scope.showAll());

  const open = shownTodos(connected, todos);

  const done = createMemo(() => doneTodos(todos.all()));
  const isEmpty = createMemo(() => todos.isLoaded() && todos.all().length === 0 && todos.failure() === null);
  const noneRunning = createMemo(() => selectedWorkstream() === null && todos.isLoaded() && todos.all().length > 0 && open().length === 0 && todos.failure() === null);
  const noneInWorkstream = createMemo(() => thisWorkstream() && todos.isLoaded() && todos.all().length > 0 && open().length === 0 && todos.failure() === null);

  const reorder = createReorder({
    ids: () => open().map((todo) => todo.id),
    all: todos.all,
    call: (params) => failureOf(() => connected.app.rpc("todo.reorder", params)),
    reducedMotion: connected.reducedMotion,
  });

  const rows = new Map<number, HTMLButtonElement>();
  let plusButton: HTMLButtonElement | undefined;

  // U138: a completed Todo leaves the open list only once its `todo.updated` Event has refetched it, so the row to focus
  // is held here until this list no longer carries `id`, then it is given to that target, else to the `+` button — but
  // only while focus is still unclaimed (null or the page body), so a request that outlives the user moving focus
  // elsewhere (typing in U16's field, Tab into the pane) never yanks it back.
  const [awaitingFocus, setAwaitingFocus] = createSignal<{ id: number; target: number | null }[]>([]);

  createEffect(() => {
    const openIds = new Set(open().map((todo) => todo.id));
    const waiting = awaitingFocus();

    if (waiting.every((request) => openIds.has(request.id))) return;

    setAwaitingFocus(
      waiting.filter((request) => {
        if (openIds.has(request.id)) return true;

        if (document.activeElement === null || document.activeElement === document.body) {
          const target = request.target !== null ? rows.get(request.target) : undefined;

          (target ?? plusButton)?.focus();
        }

        return false;
      }),
    );
  });

  // The field closes before the call so a second Enter cannot create the Todo twice.
  const create = async (title: string) => {
    setTyping(false);
    setCreateFailure(null);

    if (title === "") return;

    const home = selectedWorkstream();

    // U347: a Todo added while a Workstream is selected goes to that Workstream, so `this one` shows it.
    setCreateFailure(
      await failureOf(async () => {
        const made = await connected.app.rpc("todo.create", { title, body: null, blockers: null });

        if (home !== null) await connected.app.rpc("todo.move", { id: made.id, home });
      }),
    );
  };

  // U153: a row is selected while the Drawer it opened is the one open.
  const [shown, setShown] = createSignal<{ id: number; content: () => JSX.Element } | null>(null);
  const selectedId = () => (shown() !== null && connected.drawer.content() === shown()?.content ? shown()?.id : undefined);

  const show = (todo: Todo) => {
    const content = () => <TodoDrawer id={todo.id} todos={todos} />;

    setShown({ id: todo.id, content });
    connected.drawer.open(content);
  };

  const complete = async (todo: Todo) => {
    const target = rowAfter(todo.id, open().map((candidate) => candidate.id));
    const message = await failureOf(() => connected.app.rpc("todo.complete", { id: todo.id }));

    if (message === null) setAwaitingFocus((waiting) => [...waiting, { id: todo.id, target }]);

    return message;
  };

  return (
    <section aria-label="todos">
      <Show when={selectedWorkstream()}>
        <ScopeControl showAll={scope.showAll()} onChange={scope.setShowAll} />
      </Show>
      <button
        data-button="add"
        type="button"
        aria-label="add todo"
        class="shelf-add"
        ref={(button) => (plusButton = button)}
        onClick={() => {
          setCreateFailure(null);
          setTyping(true);
        }}
      >
        <Icon name="plus" />
        <span>todo</span>
      </button>
      <Show when={todos.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={createFailure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={typing()}>
        <input
          aria-label="new todo title"
          ref={(input) => queueMicrotask(() => input.focus())}
          onKeyDown={(key) => {
            if (key.key === "Enter") void create(key.currentTarget.value.trim());
            else if (key.key === "Escape") {
              setTyping(false);
              setCreateFailure(null);
            }
          }}
        />
      </Show>
      <Show when={isEmpty()}>
        <p>no todos yet</p>
      </Show>
      <Show when={noneRunning()}>
        <p>no todos from running agents</p>
      </Show>
      <Show when={noneInWorkstream()}>
        <p>
          no todos in this workstream{" "}
          <button data-button="quiet" type="button" onClick={() => scope.setShowAll(true)}>
            show all
          </button>
        </p>
      </Show>
      <Show when={open().length > 0}>
        <div class="todo-list shelf-list">
        <For each={open()}>
          {(todo) => (
            <OpenRow
              todo={todo}
              selected={selectedId() === todo.id}
              known={todos.byId()}
              onOpen={show}
              onComplete={complete}
              reorder={reorder}
              registerRow={(id, row) => {
                if (row) rows.set(id, row);
                else rows.delete(id);
              }}
            />
          )}
        </For>
        </div>
      </Show>
      <Show when={done().length > 0}>
        <div class="shelf-list">
          <ShelfRow glyph={<KindGlyph kind="done" decorative />}>
            <RowButton hang={false} onClick={() => setUnfolded(!unfolded())}>
              <span class="shelf-title">{done().length} done</span>
            </RowButton>
          </ShelfRow>
          <Show when={unfolded()}>
            <For each={done()}>
              {(todo) => (
                <ShelfRow glyph={null} class="todo-row">
                  <RowButton hang={false} label={`${kindOf(todo)} #${todo.id} ${todo.title}`} onClick={() => show(todo)}>
                    <span class="shelf-title" title={todo.title}>{todo.title}</span>
                  </RowButton>
                  <TickBox title={todo.title} done />
                </ShelfRow>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </section>
  );
};

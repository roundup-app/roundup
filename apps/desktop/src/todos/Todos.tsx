import ChevronUp from "lucide-solid/icons/chevron-up";
import { IconButton } from "../ui/IconButton";
import { Tip } from "../ui/Tip";
import { createNear } from "../ink/near";
import { activationSource } from "../keys/registry";
import type { ActivationSource } from "../keys/registry";
import { copy } from "../copy";
import { createBulkDelete } from "../shelf/BulkDelete";

import { createSelection } from "../shelf/selection";
import { TickBox } from "./TickBox";
import { Icon } from "../ink/Icon";
import { EmptyState } from "../ink/EmptyState";
import { EntryRow } from "../ink/EntryRow";
import * as v from "valibot";
import { untrack } from "solid-js";
import { TodoDraftRecovery, todoDraftSchema } from "./EditableText";
import type { JSX } from "solid-js";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { ErrorLine } from "../ink/ErrorLine";
import { HomeMove } from "./HomeMove";
import { homeNameOf } from "./homes";
import { ShelfRow } from "../ink/ShelfRow";
import { KindGlyph } from "../ink/KindGlyph";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf, outcomeOf } from "./failureOf";
import { RowButton } from "./RowButton";
import { createSortedList } from "./sortedList";
import { Sortable } from "../ui/sortable";
import { shelfScope } from "../shelf/scope";
import { Groups } from "../shelf/Groups";
import { useTodoList } from "./todoList";
import { TodoDrawer } from "./TodoDrawer";
import { shownTodos } from "./shownTodos";
import { doneTodos, kindOf, openBlockersOf, treeRows } from "./todoView";

const KIND_LABEL = { idle: copy.idle, blocked: copy.blocked, done: copy.done } as const;

/** U138: the row to focus once a completed Todo leaves the open list — the next one, else the previous, else none (the `+` button). */
export const rowAfter = (id: number, openIds: readonly number[]): number | null => {
  const at = openIds.indexOf(id);

  return openIds[at + 1] ?? openIds[at - 1] ?? null;
};

/** U490a: what a list ordering its rows through `ui/Sortable` hands one `OpenRow`. */
export type SortedRow = {
  /** The row's frame, which the Sortable moves. */
  frame: (el: HTMLElement | null) => void;
  /** The open button: the Sortable's handle, and the element that keeps focus after a move. */
  button: (el: HTMLButtonElement | null) => void;
  /** Where a failed move shows. */
  fail: (show: (message: string | null) => void) => void;
  /** `⌥↑` and `⌥↓`. */
  key: (event: KeyboardEvent) => void;
  step: (by: -1 | 1) => void;
};

/** One open Todo as U15 draws it, with U35's `complete` and `waits on`; `nested` is the Rail's copy (U60), which leaves `data-id` to the Agent rows. */
export const OpenRow = (props: {
  nested?: boolean;
  pressed?: boolean;
  selectionActive?: boolean;
  onPick?: (todo: Todo, event: MouseEvent) => void;
  onSelectionKey?: (todo: Todo, event: KeyboardEvent) => void;
  /** U153: the row whose Drawer is open. */
  selected?: boolean;
  todo: Todo;
  known: ReadonlyMap<number, Todo>;
  onOpen: (todo: Todo, source: ActivationSource) => void;
  onComplete: (todo: Todo) => Promise<string | null>;
  registerRow?: (id: number, row: HTMLButtonElement | null) => void;
  /** U490a: a row ordered through `ui/Sortable` instead. */
  sorted?: SortedRow;
  /** U3708: the Shelf list's tree place of this row; absent for the Rail's copy. */
  place?: { level: number; parent: number | null };
  /** U3709: what Tab and ⇧Tab do on this row; `null` where the key is not this row's. */
  nest?: { in: (() => Promise<string | null>) | null; out: (() => Promise<string | null>) | null };
}) => {
  const connected = useConnectedProject();
  const near = props.nested ? createNear() : null;
  const [listOpen, setListOpen] = createSignal(false);
  const waitingOn = createMemo(() => openBlockersOf(props.todo, props.known));

  // U3708: the other open blockers, in `blockers` order, after the one the row nests under.
  const alsoWaiting = createMemo(() => props.todo.blockers.flatMap((id) => props.known.get(id) ?? [])
    .filter((blocker) => !blocker.done && blocker.id !== props.place?.parent && (props.place?.parent != null || waitingOn().length > 1)));

  const [failure, setFailure] = createSignal<string | null>(null);

  const complete = async () => {
    const message = await props.onComplete(props.todo);

    setFailure(message);

    return message;
  };

  // Matches U9's rule: a failure clears on the next click anywhere, not only inside its own row.
  onMount(() => {
    const clear = () => setFailure(null);

    document.addEventListener("click", clear);
    onCleanup(() => document.removeEventListener("click", clear));
  });

  onCleanup(() => {
    props.registerRow?.(props.todo.id, null);
    props.sorted?.frame(null);
    props.sorted?.button(null);
  });

  props.sorted?.fail(setFailure);

  const head = (
    <div class="row-head">
        <RowButton
          hang={false}
          label={copy.todoRow(KIND_LABEL[kindOf(props.todo)], props.todo.id, props.todo.title)}
          tooltip={failure() === null ? props.todo.title : undefined}
          pressed={props.pressed}
          selectionActive={props.selectionActive}
          onClick={(event) => props.onPick ? props.onPick(props.todo, event) : props.onOpen(props.todo, activationSource(event))}
          reorderable={props.sorted !== undefined}
          nest={props.nest ? (out) => (out ? props.nest?.out : props.nest?.in) ?? null : undefined}
          onNest={async (run) => setFailure(await run())}
          onKeyDown={(event) => {
            props.onSelectionKey?.(props.todo, event);

            props.sorted?.key(event);
          }}
          ref={(row) => {
            props.registerRow?.(props.todo.id, row);
            props.sorted?.button(row);
          }}
        >
          {(trigger) => <span {...trigger()} class="shelf-title">{props.todo.title}</span>}
        </RowButton>
        <Show when={!props.nested && props.sorted}>
          <div class="todo-row-actions" role="group" aria-label={copy.rowActionsFor(props.todo.id)}>
            <Show when={props.sorted}>
              <IconButton aria-label={copy.moveUp} onClick={() => props.sorted?.step(-1)}><ChevronUp class="icon" aria-hidden="true" width={16} height={16} stroke-width={1.75} /></IconButton>
              <IconButton aria-label={copy.moveDown} onClick={() => props.sorted?.step(1)}><Icon name="down" /></IconButton>
            </Show>
          </div>
        </Show>
        <Show when={props.nested}>
          <HomeMove
            id={props.todo.id}
            home={props.todo.home}
            onOpenChange={setListOpen}
            choose={async (home) => {
              const message = await failureOf(() => connected.app.rpc("todo.move", { id: props.todo.id, home }));

              setFailure(message);

              return message;
            }}
          />
          <button data-button="row-action" type="button" class="word complete" onClick={() => void complete()}>{copy.complete}</button>
        </Show>
      </div>
  );

  return (
    <ShelfRow
      glyph={props.nested ? <KindGlyph kind={kindOf(props.todo)} /> : <>
        <TickBox todo={props.todo} onComplete={complete} />
        <Show when={props.todo.blocked && props.place?.parent == null}><KindGlyph kind="blocked" /></Show>
      </>}
      data-id={props.nested ? undefined : props.todo.id}
      data-todo={props.todo.id}
      data-actions-open={near?.near() || listOpen() ? "true" : undefined}
      data-shelf-row={props.nested ? undefined : ""}
      data-selected={props.selected ? "true" : undefined}
      role={props.place ? "treeitem" : undefined}
      aria-level={props.place?.level}
      data-level={props.place?.level}
      style={props.place ? { "padding-inline-start": `calc(var(--space-2) + ${props.place.level - 1} * var(--space-5))` } : undefined}
      class={props.nested ? "todo-row" : "todo-row todo-inset"}
      head={props.nested ? undefined : head}
      {...near?.handlers}
      ref={(frame) => {
        props.sorted?.frame(frame);
      }}
    >
      <Show when={props.nested}>{head}</Show>
      <Show when={props.todo.body.trim() !== ""}>
        <p class="item-description" data-todo-description>{props.todo.body.trim()}</p>
      </Show>
      <Show when={failure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={props.nested}>
        <p class="shelf-meta" data-todo-meta>
          <Show when={props.nested}><span data-mono>{copy.todoNumberMark}{props.todo.id}</span>{" "}</Show>
          <Show when={props.nested && failure() === null && waitingOn().length > 0}>
            <span data-todo-waits>
              <Tip class="todo-tooltip" text={copy.waitsOnTitles(waitingOn().map((blocker) => blocker.title).join(copy.comma))}>{(trigger) => <span {...trigger()}>{copy.waitsOnWord}</span>}</Tip><span class="todo-blockers"><For each={waitingOn()}>{(blocker, index) => (
                <>
                  <Show when={index() > 0}><span>{copy.comma}</span></Show>
                  <button data-button="quiet" type="button" class="word todo-blocker" data-mono="" onClick={(event) => props.onOpen(blocker, activationSource(event))}>#{blocker.id}</button>
                </>
              )}</For></span>
            </span>
          </Show>
          <Show when={props.nested}>
            {" "}<span data-todo-home>{copy.in}<span data-mono>{homeNameOf(connected.rail.nodes, props.todo.home)}</span></span>
          </Show>
        </p>
      </Show>
      <Show when={!props.nested && failure() === null && alsoWaiting().length > 0}>
        <p class="shelf-meta" data-todo-meta>
          <Tip class="todo-tooltip" text={copy.alsoWaitsOn(alsoWaiting().map((blocker) => blocker.title).join(copy.comma))}>{(trigger) => <span {...trigger()} data-todo-also-waits>{copy.alsoWaitsOn("")}<For each={alsoWaiting()}>{(blocker, index) => (
            <>
              <Show when={index() > 0}><span>{copy.comma}</span></Show>
              <button data-button="quiet" type="button" class="word todo-blocker" aria-label={copy.openBlocker(blocker.title)} onClick={(event) => props.onOpen(blocker, activationSource(event))}>{blocker.title}</button>
            </>
          )}</For></span>}</Tip>
        </p>
      </Show>
    </ShelfRow>
  );
};

/** The Shelf's `todos` list: open Todos in id order, done ones folded, and the inline field that makes a new one. */
export const Todos = () => {
  const connected = useConnectedProject();
  connected.drafts.validate("todos", todoDraftSchema);
  const todos = useTodoList();
  const [typing, setTyping] = createSignal(false);
  const [createFailure, setCreateFailure] = createSignal<string | null>(null);
  const [unfolded, setUnfolded] = createSignal(false);
  const scope = shelfScope(connected);
  const selectedWorkstream = scope.home;

  const open = shownTodos(connected, todos);

  const selection = createSelection(() => [...open(), ...(unfolded() ? done() : [])].map((todo) => todo.id), () => connected.rail.selected() ?? "overview");

  const done = createMemo(() => doneTodos(todos.all()).filter((todo) =>
    scope.includes(todo.home, todo.creator)));

  const target = (todo: Todo) => ({ id: todo.id, label: todo.title });

  const bulk = createBulkDelete({
    selected: selection.selected,
    targets: () => [...open(), ...(unfolded() ? done() : [])].map(target),
    done: () => done().map(target),
    context: () => connected.rail.selected() ?? "overview",
    noun: copy.todos,
    replace: selection.replace, clear: selection.clear, cancelSelection: selection.cancel,
    remove: (id) => failureOf(() => connected.app.rpc("todo.delete", { id })),
    reload: async () => {
      await todos.reload();

      return todos.failure();
    },
    reveal: () => setUnfolded(true),
  });

  const selectionKey = (todo: Todo, event: KeyboardEvent) => {
    bulk.key(event);

    if (!bulk.pending()) selection.key(todo.id, event);
  };

  const isEmpty = createMemo(() => todos.isLoaded() && todos.all().length === 0 && todos.failure() === null);

  const sorted = createSortedList({
    ids: () => open().map((todo) => todo.id),
    all: todos.all,
    call: (params) => failureOf(() => connected.app.rpc("todo.reorder", params)),
    reducedMotion: connected.reducedMotion,
    home: {
      target: (id, x, y) => {
        const current = todos.byId().get(id)?.home;
        const rail = document.querySelector(".rail");
        const clip = rail?.getBoundingClientRect();

        if (!clip || x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom) return null;

        for (const element of rail!.querySelectorAll<HTMLElement>(".rail-row[data-id], [data-todo-root]")) {
          const box = element.getBoundingClientRect();

          if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
          const home = element.hasAttribute("data-todo-root") ? null : element.dataset.id!;

          if (home === current || (home !== null && !connected.rail.nodes.some((node) => node.id === home && node.kind === "workstream"))) return null;

          return { element, home };
        }

        return null;
      },
      move: (id, home) => failureOf(() => connected.app.rpc("todo.move", { id, home })),
    },
  });

  // U138, U3709: the refetch that moves a nested row remounts it, so its new button takes focus (`mounted`) while focus is unclaimed.
  let nestFocus: number | null = null;

  const mounted = (id: number, button: HTMLButtonElement) => {
    if (nestFocus !== id) return;
    nestFocus = null;
    queueMicrotask(() => {
      if (button.isConnected && (document.activeElement === document.body || document.activeElement === null)) button.focus();
    });
  };

  /** U3709, U3711: Tab nests a row under the one above it and ⇧Tab un-nests it, each one `todo.setBlockers`; the Daemon refuses a cycle (T4). */
  const nestOf = (todo: Todo, parent: number | null, above: Todo | null, first: boolean) => {
    const call = (blockers: number[]) => async () => {
      nestFocus = todo.id;

      const message = await failureOf(() => connected.app.rpc("todo.setBlockers", { id: todo.id, blockers }));

      if (message !== null) nestFocus = null;

      return message;
    };

    return {
      in: first || above === null || parent === above.id ? null : call([above.id, ...todo.blockers.filter((id) => id !== above.id)]),
      out: parent === null ? null : call(todo.blockers.filter((id) => id !== parent)),
    };
  };

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

  const [creationHome, setCreationHome] = createSignal<string | null>(null);
  const creationTarget = () => ({ surface: "todos", object: "new", recipient: creationHome() });

  createEffect(() => {
    if (typing()) onCleanup(connected.drafts.editor(creationTarget()));
  });

  const creation = () => connected.drafts.list().findLast(draft => draft.destination.surface === "todos"
    && draft.destination.object === "new" && draft.destination.recipient === creationHome() && draft.status === "draft");

  const retainCreation = (field: HTMLInputElement) => {
    const previous = creation();
    const caret = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" };

    if ((!previous && field.value === "") || (previous?.value.title === field.value && JSON.stringify(previous.selection) === JSON.stringify(caret))) return;

    connected.drafts.edit(creationTarget(), { title: field.value, home: creationHome() }, caret, "ordinary");
  };

  // EntryRow clears after capturing this revision, so another Enter cannot submit it twice.
  const create = async (title: string) => {
    setCreateFailure(null);

    const draft = creation();

    if (!draft || !connected.drafts.submit(draft.revision)) return;
    const home = creationHome();

    try {
      const made = await connected.app.rpc("todo.create", { title, body: null, blockers: null });
      // Creation is acknowledged before placement: a failed move must never invite duplicate creation.
      connected.drafts.settle(draft.revision, "acknowledged");

      if (home !== null) await connected.app.rpc("todo.move", { id: made.id, home });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      connected.drafts.settle(draft.revision, outcomeOf(error));
      setCreateFailure(error.message);
    }
  };

  // U153: a row is selected while the Drawer it opened is the one open.
  const [shown, setShown] = createSignal<{ id: number; content: () => JSX.Element } | null>(null);
  const selectedId = () => (shown() !== null && connected.drawer.content() === shown()?.content ? shown()?.id : undefined);

  const show = (todo: Todo, source: ActivationSource) => {
    const content = () => <TodoDrawer id={todo.id} todos={todos} />;

    setShown({ id: todo.id, content });
    connected.drawer.open(content, source);
  };

  const complete = async (todo: Todo) => {
    const target = rowAfter(todo.id, open().map((candidate) => candidate.id));
    const message = await failureOf(() => connected.app.rpc("todo.complete", { id: todo.id }));

    if (message === null) setAwaitingFocus((waiting) => [...waiting, { id: todo.id, target }]);

    return message;
  };

  return (
    <section aria-label={copy.todos}>
      <button
        data-button="add"
        type="button"
        aria-label={copy.addTodo}
        class="shelf-add"
        ref={(button) => (plusButton = button)}
        onClick={(event) => {
          setCreateFailure(null);

          if (typing()) {
            event.currentTarget.parentElement?.querySelector<HTMLInputElement>(".entry-field")?.focus();

            return;
          }

          setCreationHome(selectedWorkstream());
          const draft = creation();

          if (draft && !v.safeParse(v.string(), draft.value.title).success) {
            setCreateFailure(copy.draftRetention(connected.project.path, copy.draftSurface("todos"), "invalid"));

            return;
          }

          setTyping(true);
        }}
      >
        <Icon name="plus" />
        <span>{copy.todo}</span>
      </button>
      <Show when={todos.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={createFailure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={isEmpty() && !typing()}>
        <EmptyState icon="check" heading={copy.noTodosYet} hint={copy.noTodosHint} />
      </Show>
      <Show when={open().length + done().length > 0}>
        <Groups items={() => [...open(), ...done()]} home={todo => todo.home} maker={todo => todo.creator}>{items => <>
        <Sortable.Root class="todo-list shelf-list" plain ids={treeRows(items().filter(todo => !todo.done)).map((row) => String(row.todo.id))} onOrderChange={sorted.order} external={sorted.external}>
        <For each={treeRows(items().filter(todo => !todo.done))}>
          {(row, at) => {
            const todo = row.todo;
            const tree = () => treeRows(items().filter(todo => !todo.done));

            return (
            <Sortable.Item id={String(todo.id)} index={at()} pressable>
              {(parts) => (
            <OpenRow
              todo={todo}
              selected={selection.selected().includes(todo.id) || selectedId() === todo.id}
              pressed={selection.selected().includes(todo.id)}
              selectionActive={selection.selected().length > 0}
              onPick={(item, event) => !bulk.pending() && selection.click(item.id, event, () => show(item, activationSource(event)))}
              onSelectionKey={selectionKey}
              known={todos.byId()}
              onOpen={show}
              onComplete={complete}
              sorted={sorted.row(todo.id, parts, () => tree().map(({ todo }) => todo.id))}
              place={{ level: row.level, parent: row.parent }}
              nest={nestOf(todo, row.parent, tree().at(at() - 1)?.todo ?? null, at() === 0)}
              registerRow={(id, row) => {
                selection.register(id, row);

                if (row) {
                  rows.set(id, row);
                  mounted(id, row);
                } else rows.delete(id);
              }}
            />
              )}
            </Sortable.Item>
          );}}
        </For>
        </Sortable.Root>
        <Show when={unfolded()}>
            <For each={items().filter(todo => todo.done)}>
              {(todo) => (
                <ShelfRow
                  glyph={<TickBox todo={todo} />}
                  class="todo-row todo-inset"
                  data-id={todo.id}
                  data-todo={todo.id}
                  data-selected={selection.selected().includes(todo.id) ? "true" : undefined}
                  head={
                    <RowButton
                      hang={false}
                      label={copy.todoRow(KIND_LABEL[kindOf(todo)], todo.id, todo.title)}
                      tooltip={todo.title}
                      pressed={selection.selected().includes(todo.id)}
                      selectionActive={selection.selected().length > 0}
                      ref={(row) => selection.register(todo.id, row)}
                      onKeyDown={(event) => selectionKey(todo, event)}
                      onClick={(event) => !bulk.pending() && selection.click(todo.id, event, () => show(todo, activationSource(event)))}
                    >
                      {(trigger) => <span {...trigger()} class="shelf-title">{todo.title}</span>}
                    </RowButton>
                  }
                />
              )}
            </For>
        </Show>
        </>}</Groups>
      </Show>
      <Show when={typing()}>
        <div class="shelf-list">
          <EntryRow
            glyph={<input type="checkbox" class="todo-tick" disabled tabIndex={-1} aria-hidden="true" />}
            class="todo-inset"
            label={copy.newTodoTitle}
            placeholder={copy.newTodoPlaceholder}
            initial={untrack(() => {
              const draft = creation();
              const title = v.safeParse(v.string(), draft?.value.title);

              return { text: title.success ? title.output : "", selection: draft?.selection ?? null };
            })}
            onEdit={retainCreation}
            onSubmit={(title) => void create(title)}
            onClose={(reason) => {
              setTyping(false);

              if (reason === "escape") setCreateFailure(null);

              if (reason !== "blur") plusButton?.focus();
            }}
          />
        </div>
      </Show>
      <TodoDraftRecovery object="new" active={typing()} onDiscard={revision => {
        if (creation()?.revision === revision) setTyping(false);
      }} />
      <Show when={done().length > 0}>
        <div class="shelf-list">
          <ShelfRow glyph={<KindGlyph kind="done" decorative />} class="todo-inset">
            <div class="shelf-done-line">
              <RowButton hang={false} onClick={() => setUnfolded(!unfolded())}>
                {() => <span class="shelf-title">{done().length}{copy.doneCount}</span>}
              </RowButton>
              <button data-button="quiet" type="button" onClick={() => bulk.ask(true)}>{copy.clearDone}</button>
            </div>
          </ShelfRow>

        </div>
      </Show>
      <Show when={todos.isLoaded()}>
        <For each={[...new Set(connected.drafts.list().filter(draft => draft.destination.surface === "todos"
          && draft.destination.object !== "new" && !todos.byId().has(Number(draft.destination.object))).map(draft => draft.destination.object))]}>{object => <div>
          <ErrorLine message={copy.draftIdentity(copy.originalUnavailable, object)} />
          <TodoDraftRecovery object={object} />
        </div>}</For>
      </Show>
      <bulk.Bar />
    </section>
  );
};

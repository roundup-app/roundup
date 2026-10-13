import { Icon } from "../ink/Icon";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { ErrorLine } from "../ink/ErrorLine";
import { KindGlyph } from "../ink/KindGlyph";
import { TickBox } from "./TickBox";
import { TodoHistory } from "./TodoHistory";
import "./drawer.styles.css";
import { useConnectedProject } from "../state/connectedProject";
import { EditableText } from "./EditableText";
import { failureOf } from "./failureOf";
import { RowButton } from "./RowButton";
import type { TodosState } from "./state";
import { blockedBy, blockersOf, kindOf, offeredAsBlockers } from "./todoView";

const TodoLine = (props: { todo: Todo }) => (
  <p style={{ "white-space": "pre-wrap" }}>
    <KindGlyph kind={kindOf(props.todo)} /> {`#${props.todo.id}  ${props.todo.title}`}
  </p>
);

/** The current Todo follows list Events; TodoHistory captures and acknowledges this opening's read. */
export const TodoDrawer = (props: { id: number; todos: TodosState }) => {
  const { app, drawer } = useConnectedProject();

  const [failure, setFailure] = createSignal<string | null>(null);
  const [offering, setOffering] = createSignal(false);
  const [removedByMe, setRemovedByMe] = createSignal(false);
  const [asking, setAsking] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  let deleteButton: HTMLButtonElement | undefined;

  const attempt = async <Result,>(call: () => Promise<Result>) => {
    const message = await failureOf(call);

    setFailure(message);

    return message;
  };

  const [completed, setCompleted] = createSignal(false);
  const todo = () => props.todos.byId().get(props.id);
  let titleRow: HTMLDivElement | undefined;

  const complete = () => attempt(async () => {
    const focused = document.activeElement === titleRow?.querySelector("input");
    await app.rpc("todo.complete", { id: props.id });
    setCompleted(true);

    const stayed = document.activeElement === titleRow?.querySelector("input") || document.activeElement === document.body;

    if (focused && stayed) titleRow?.querySelector<HTMLElement>("p[tabindex]")?.focus();
  });

  // Picks run one after another, each from the list the previous one answered: the list state only catches up when the Event arrives.
  const [answered, setAnswered] = createSignal<Todo | null>(null);
  let picks: Promise<unknown> = Promise.resolve();

  // The list state does not refire when only this Todo's fields change, so the cache watches the blockers itself.
  createEffect(on(() => todo()?.blockers.join(","), () => setAnswered(null), { defer: true }));

  // U152, U138: a keyboard step that removes the focused button hands focus to `+ blocker`, never the page body.
  let blockerButton: HTMLButtonElement | undefined;
  let removing = false;

  createEffect(
    on(
      () => todo()?.blockers.join(","),
      () => {
        if (!removing) return;

        removing = false;
        queueMicrotask(() => {
          if (!document.activeElement || document.activeElement === document.body) blockerButton?.focus();
        });
      },
      { defer: true },
    ),
  );

  const blockerBase = () => answered() ?? todo();

  const changeBlockers = (next: (blockers: number[]) => number[]) => {
    const pick = () =>
      attempt(async () => {
        const base = blockerBase();

        if (!base) return;

        setAnswered(await app.rpc("todo.setBlockers", { id: props.id, blockers: next(base.blockers) }));
      });

    // A bug that rejects one pick is reported, and the picks behind it still run.
    picks = picks.then(pick, (bug) => {
      reportError(bug);

      return pick();
    });
  };

  const addBlocker = (blocker: number) => changeBlockers((blockers) => [...blockers, blocker]);

  /** U152: the other blockers stay, in order. */
  const removeBlocker = (blocker: number) => {
    removing = true;
    changeBlockers((blockers) => blockers.filter((id) => id !== blocker));
  };

  const keep = () => {
    setAsking(false);
    queueMicrotask(() => deleteButton?.focus());
  };

  // A confirmation owns Escape before DrawerHost's document listener.
  const escape = (event: KeyboardEvent) => {
    if (!asking() || event.key !== "Escape") return;
    event.preventDefault(); event.stopImmediatePropagation(); keep();
  };

  document.addEventListener("keydown", escape, true);
  onCleanup(() => document.removeEventListener("keydown", escape, true));

  return (
    <>
      <div class="todo-detail">
        <Show when={asking() && todo()}>
          <p class="todo-delete-confirm" role="group" aria-label="Delete Todo?" onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault(); event.stopPropagation(); keep();
          }}>
            Delete Todo?{" "}
            <button data-button="quiet"
              type="button"
              class="word light"
              disabled={deleting()}
              onClick={() => {
                if (deleting()) return;
                setDeleting(true);
                void attempt(async () => {
                  await app.rpc("todo.delete", { id: props.id });
                  setRemovedByMe(true);
                  drawer.close();
                }).then(() => setDeleting(false));
              }}
            >
              Delete
            </button>{" "}
            <button data-button="quiet"
              type="button"
              class="word light"
              ref={(button) => queueMicrotask(() => button.focus({ preventScroll: true }))}
              onClick={keep}
            >
              Keep
            </button>
          </p>
        </Show>
        <Show when={failure()}>{(message) => <ErrorLine message={message()} />}</Show>
          <Show
            when={todo()}
            fallback={
              <Show when={!removedByMe() && !deleting()}>
                <ErrorLine message={`#${props.id} was deleted`} />
              </Show>
            }
          >
            {(current) => (
              <>
                <div class="todo-detail-title" ref={(element) => { titleRow = element; }}>
                  <TickBox todo={{ ...current(), done: completed() || current().done }} onComplete={complete} />
                  <EditableText
                    name="title"
                    multiline={false}
                    value={current().title}
                    commit={(title) => attempt(() => app.rpc("todo.update", { id: props.id, title, body: null }))}
                  />
                </div>
                <div class="todo-detail-body">
                <EditableText
                  name="body"
                  multiline
                  value={current().body}
                  commit={(body) => attempt(() => app.rpc("todo.update", { id: props.id, title: null, body }))}
                />
                </div>
                <Show when={blockersOf(current(), props.todos.byId()).length > 0}>
                  <div class="todo-dependencies" style={{ display: "grid", "grid-template-columns": "1fr auto", "column-gap": "var(--space-2)" }}>
                    <p class="light" style={{ "grid-column": "1 / -1" }}>Waits on</p>
                    <For each={blockersOf(current(), props.todos.byId())}>
                      {(blocker) => (
                        <>
                          <TodoLine todo={blocker} />
                          <button data-button="quiet" type="button" class="word light" aria-label={`Remove blocker #${blocker.id}`} onClick={() => removeBlocker(blocker.id)}>
                            Remove
                          </button>
                        </>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={blockedBy(current(), props.todos.all()).length > 0}>
                  <div class="todo-dependencies">
                    <p class="light">Blocks</p>
                    <For each={blockedBy(current(), props.todos.all())}>{(blocked) => <TodoLine todo={blocked} />}</For>
                  </div>
                </Show>
                <p>
                  <button data-button="add" type="button" class="word" ref={(element) => { blockerButton = element; }} onClick={() => setOffering(!offering())}>
                    <Icon name="plus" /> Blocker
                  </button>
                </p>
                <Show when={offering()}>
                  <For each={offeredAsBlockers(answered() ?? current(), props.todos.all())}>
                    {(other) => (
                      <RowButton
                        onClick={() => {
                          setOffering(false);
                          blockerButton?.focus();
                          addBlocker(other.id);
                        }}
                      >
                        <KindGlyph kind={kindOf(other)} /> {`#${other.id}  ${other.title}`}
                      </RowButton>
                    )}
                  </For>
                </Show>
                <TodoHistory id={props.id} />
              </>
            )}
          </Show>
      </div>
      <Show when={todo()}>
        <button data-button="icon" type="button" class="word todo-delete" aria-label="Delete Todo"
          ref={(button) => { deleteButton = button; }}
          onClick={() => { setFailure(null); setAsking(true); }}>
          <Icon name="trash" />
        </button>
      </Show>
    </>
  );
};

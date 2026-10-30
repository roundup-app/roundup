import { outcomeOf } from "../app/seam";
import { captureFocus } from "../keys/focus";
import { todoEditor } from "../drawer/editors";
import * as v from "valibot";
import { IconButton } from "../ui/IconButton";
import { copy } from "../copy";
import { Icon } from "../ink/Icon";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Change } from "@contracts/todo/Change";
import type { Todo } from "@contracts/todo/Todo";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { TickBox } from "./TickBox";
import { TodoComments } from "./TodoComments";
import { TodoRefs } from "./TodoRefs";
import { TodoHistory } from "./TodoHistory";
import "./drawer.styles.css";
import { useConnectedProject } from "../state/connectedProject";
import { useTodoList } from "./todoList";
import { EditableText, TodoDraftRecovery, todoDraftSchema, formSchema, blockerSchema } from "./EditableText";
import { doesClearTodoFailure, failureOf } from "./failureOf";
import { BlockerMenu } from "./BlockerMenu";
import type { TodosState } from "./state";
import { blockedBy, blockersOf, kindOf, offeredAsBlockers } from "./todoView";

const TodoLine = (props: { todo: Todo }) => (
  <p style={{ "white-space": "pre-wrap" }}>
    <KindGlyph kind={kindOf(props.todo)} /> <span class="mono">#{props.todo.id}</span>{`  ${props.todo.title}`}
  </p>
);

/** The current Todo follows list Events; TodoHistory captures and acknowledges this opening's read. */
export const TodoDrawer = (props: {
  id: number;
  onComment?: (focus: ReturnType<typeof captureFocus>) => void;
  todos: TodosState;
  /** Recovery uses loaded original identities and never fetches or acknowledges History. */
  recovery?: { project: string; revision: string };
}) => {
  const { app, drawer, drafts, project, events } = useConnectedProject();
  drafts.validate("todos", todoDraftSchema);

  const retained = props.recovery ? drafts.list().find(draft => draft.revision === props.recovery?.revision
    && draft.destination.surface === "todos" && draft.destination.object === String(props.id)) : undefined;

  const original = props.todos.byId().get(props.id);
  const originalHome = original?.home;
  const fieldForm = v.safeParse(formSchema, retained?.value);
  const blockersForm = v.safeParse(blockerSchema, retained?.value);

  if (props.recovery && (props.recovery.project !== project.path || props.todos.project !== project.path || !props.todos.isLoaded() || props.todos.failure() !== null
    || !original || !retained || (retained.value.home !== undefined && retained.value.home !== originalHome) || !(fieldForm.success && (retained.destination.recipient === "title" || retained.destination.recipient === "body")
      || blockersForm.success && retained.destination.recipient?.startsWith("blockers:")))) return null;

  const [blockerRevision, setBlockerRevision] = createSignal(blockersForm.success ? retained?.revision : undefined);
  const blockerDraft = () => blockerRevision() === undefined ? undefined : drafts.list().find(draft => draft.revision === blockerRevision());

  const blockerForm = () => {
    const parsed = v.safeParse(blockerSchema, blockerDraft()?.value);

    return parsed.success ? parsed.output : undefined;
  };

  const titleRevision = () => retained?.destination.recipient === "title" ? retained.revision : undefined;
  const bodyRevision = () => retained?.destination.recipient === "body" ? retained.revision : undefined;

  const [titleFailure, setTitleFailure] = createSignal<string | null>(null);
  let dismissTitle: (() => void) | undefined;
  const [captured, setCaptured] = createSignal<Change>();
  const [failure, setFailure] = createSignal<string | null>(null);
  const [offering, setOffering] = createSignal(false);
  const [noticeDismissed, setNoticeDismissed] = createSignal(false);
  const [removedByMe, setRemovedByMe] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [deleteRefused, setDeleteRefused] = createSignal(0);

  const deletionRefusal = () => !deleteRefused() ? null
    : drafts.todoUndo.uncertain() ? (drafts.todoUndo.ids().length ? copy.todoDeleteUnconfirmed(drafts.todoUndo.ids()) : copy.deleteUnconfirmed)
    : drafts.todoUndo.pending() ? copy.todoRestorePending : null;

  const [saved, setSaved] = createSignal(0);
  const clearFailure = () => { setFailure(null); setTitleFailure(null); setSaved(value => value + 1); };

  createEffect(on(() => props.id, () => { clearFailure(); setNoticeDismissed(false); }, { defer: true }));
  onCleanup(events.subscribe(event => {
    if (doesClearTodoFailure(event, props.id)) clearFailure();
  }));

  const attempt = async <Result,>(call: () => Promise<Result>) => {
    const message = await failureOf(call);

    if (message === null) clearFailure();
    else setFailure(message);

    return message;
  };

  const todo = () => {
    const current = props.todos.byId().get(props.id);

    if (props.recovery && (current?.home !== originalHome)) return undefined;

    const form = props.recovery ? blockerForm() : undefined;

    return current && form ? { ...current, title: form.title, body: form.body, done: form.done, blockers: form.blockers.map(Number) } : current;
  };

  let titleRow: HTMLDivElement | undefined;

  const toggle = () => attempt(async () => {
    const focus = captureFocus();
    const focused = document.activeElement === titleRow?.querySelector("input");
    const reopening = props.todos.byId().get(props.id)?.done;
    await (reopening ? app.rpc("todo.reopen", { id: props.id }) : app.rpc("todo.complete", { id: props.id }));

    const stayed = document.activeElement === titleRow?.querySelector("input") || document.activeElement === document.body;

    if (!reopening && focused && stayed) focus(() => titleRow?.querySelector<HTMLElement>("p[tabindex]")?.focus());
  });

  // Picks run one after another, each from the list the previous one answered: the list state only catches up when the Event arrives.
  const [answered, setAnswered] = createSignal<Todo | null>(null);
  let picks: Promise<unknown> = Promise.resolve();

  // The list state does not refire when only this Todo's fields change, so the cache watches the blockers itself.
  createEffect(on(() => todo()?.blockers.join(","), () => setAnswered(null), { defer: true }));

  // U152, U138: a keyboard step that removes the focused button hands focus to `+ blocker`, never the page body.
  let blockerButton: HTMLButtonElement | undefined;
  let removing: ReturnType<typeof captureFocus> | null = null;

  createEffect(
    on(
      () => todo()?.blockers.join(","),
      () => {
        if (!removing) return;

        const focus = removing;
        removing = null;
        queueMicrotask(() => focus(() => {
          if (!document.activeElement || document.activeElement === document.body) blockerButton?.focus();
        }));
      },
      { defer: true },
    ),
  );

  const blockerBase = () => answered() ?? todo();

  const changeBlockers = (action: "add" | "remove", blocker: number) => {
    const base = blockerBase();

    if (!base) return;
    const restored = blockerForm();

    if (props.recovery && restored) {
      const draft = blockerDraft();

      if (!draft) return;
      const blockers = action === "add" ? [...new Set([...restored.blockers, String(blocker)])] : restored.blockers.filter(id => id !== String(blocker));
      setBlockerRevision(drafts.edit(draft.destination, { ...restored, blockers }, draft.selection, "ordinary", draft.revision).draft.revision);

      return;
    }

    const capture = captured();
    const original = capture?.after ?? base;

    const next = (blockers: number[]) => action === "add"
      ? [...new Set([...blockers, blocker])] : blockers.filter(id => id !== blocker);

    // Each queued choice owns its revision, even while its History read is outstanding.
    const destination = { surface: "todos", object: String(props.id), recipient: `blockers:${crypto.randomUUID()}` };

    const origin = { home: base.home, originalTitle: original.title, originalBody: original.body, originalDone: original.done,
      originalBlockers: original.blockers.map(String), originalChange: capture?.seq ?? null, action, blocker };

    const waiting = drafts.edit(destination, { ...origin, title: original.title, body: original.body, done: original.done,
      blockers: next(original.blockers).map(String), baseBlockers: original.blockers.map(String), expected_change: capture?.seq ?? null }, null, "ordinary").draft;

    const pick = async () => {
      // A queued add/remove composes with the preceding accepted pick, using one Values/sequence pair.
      let change: Change | undefined;
      const readFailure = await failureOf(async () => { change = (await app.rpc("todo.getHistory", { id: props.id })).changes.at(-1); });

      // Discarding a choice before its read returns never authorizes a later mutation.
      if (!drafts.list().some(draft => draft.revision === waiting.revision)) return;

      if (readFailure !== null || !change) {
        (await drafts.submit(waiting.revision));
        drafts.settle(waiting.revision, "failed");
        setFailure(readFailure ?? copy.originalUnverified);

        return;
      }

      const blockers = next(change.after.blockers);

      const draft = drafts.edit(destination, { ...origin, title: change.after.title, body: change.after.body,
        done: change.after.done, blockers: blockers.map(String), baseBlockers: change.after.blockers.map(String), expected_change: change.seq }, null, "ordinary").draft;

      (await drafts.submit(draft.revision));

      try {
        setAnswered(await app.rpc("todo.setBlockers", { id: props.id, blockers, expected_change: change.seq }));
        drafts.settle(draft.revision, "acknowledged");
        clearFailure();
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        drafts.settle(draft.revision, outcomeOf(error));
        setFailure(error.message);
      }
    };

    // A bug that rejects one pick is reported, and the picks behind it still run.
    picks = picks.then(pick, (bug) => {
      reportError(bug);

      return pick();
    });
  };

  const saveBlockers = async () => {
    const draft = blockerDraft();
    const form = blockerForm();

    if (!todo() || !draft || !form) return;

    if (form.expected_change === null) {
      setFailure(copy.originalUnverified);

      return;
    }

    const target = props.id;

    if (!(await drafts.submit(draft.revision))) {
      setFailure(copy.draftStatus[draft.status]);

      return;
    }

    try {
      setAnswered(await app.rpc("todo.setBlockers", { id: target, blockers: form.blockers.map(Number), expected_change: form.expected_change }));
      drafts.settle(draft.revision, "acknowledged");
      clearFailure();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      drafts.settle(draft.revision, outcomeOf(error));
      setFailure(error.message);
    }
  };

  const addBlocker = (blocker: number) => changeBlockers("add", blocker);

  /** U152: the other blockers stay, in order. */
  const removeBlocker = (blocker: number) => {
    removing = captureFocus();
    changeBlockers("remove", blocker);
  };

  return (
    <>
      <div class="todo-detail">
        <ReservedLine class="todo-delete-feedback"
          aria-live={drafts.todoUndo.uncertain() ? undefined : "polite"} aria-atomic="true"
          message={deletionRefusal() && drafts.todoUndo.uncertain() ? deletionRefusal() : failure()}
          status={deletionRefusal() && !drafts.todoUndo.uncertain() ? deletionRefusal() : null}
          content={deletionRefusal() ? <Show when={deleteRefused()} keyed>{press => <span>{press > 0 && deletionRefusal()}</span>}</Show> : undefined}>
          <Show when={deletionRefusal() && drafts.todoUndo.uncertain()}>
            <button data-button="quiet" type="button" disabled={drafts.todoUndo.pending()} onClick={() => void drafts.todoUndo.retryDelete()}>{copy.todoDeleteRetry}</button>
          </Show>
          <button data-dismiss-failure onMouseDown={event => event.preventDefault()} data-button="quiet" class="word" type="button" onClick={() => { setDeleteRefused(0); setFailure(null); }}>{copy.dismissFailure}</button></ReservedLine>
          <Show
            when={todo()}
            fallback={
              <ReservedLine message={!removedByMe() && !deleting() && !noticeDismissed() ? copy.todoDeleted(props.id) : null}><button data-dismiss-failure onMouseDown={event => event.preventDefault()} data-button="quiet" class="word" type="button" onClick={() => setNoticeDismissed(true)}>{copy.dismissFailure}</button></ReservedLine>
            }
          >
            {(current) => (
              <>
                <div class="todo-detail-title" ref={(element) => { titleRow = element; }}>
                  <Show when={props.todos.byId().get(props.id)}>{accepted => <TickBox todo={accepted()} onToggle={toggle} />}</Show>
                  <EditableText
                    todo={current()}
                    captured={captured}
                    saved={saved}
                    onSaved={clearFailure}
                    revision={titleRevision()}
                    onFailure={(message, dismiss) => { setTitleFailure(message); dismissTitle = dismiss; }}
                    name="title"
                    multiline={false}
                    commit={async (title, expected_change) => { await app.rpc("todo.update", { id: props.id, title, body: null, expected_change }); }}
                  />
                </div>
                <ReservedLine message={titleFailure()}><button data-dismiss-failure onMouseDown={event => event.preventDefault()} data-button="quiet" class="word" type="button" onClick={() => dismissTitle?.()}>{copy.dismissFailure}</button></ReservedLine>
                <div class="todo-detail-body">
                <EditableText
                  todo={current()}
                  captured={captured}
                  saved={saved}
                  onSaved={clearFailure}
                  revision={bodyRevision()}
                  name="body"
                  multiline
                  commit={async (body, expected_change) => { await app.rpc("todo.update", { id: props.id, title: null, body, expected_change }); }}
                />
                </div>
                <Show when={!props.recovery}><TodoRefs id={props.id} saved={saved} onSaved={clearFailure} /></Show>
                <Show when={blockersOf(current(), props.todos.byId()).length > 0}>
                  <div class="todo-dependencies" style={{ display: "grid", "grid-template-columns": "1fr auto", "column-gap": "var(--space-2)" }}>
                    <p class="light" style={{ "grid-column": "1 / -1" }}>{copy.waitsOn}</p>
                    <For each={blockersOf(current(), props.todos.byId())}>
                      {(blocker) => (
                        <>
                          <TodoLine todo={blocker} />
                          <button data-button="quiet" type="button" class="word light" aria-label={copy.removeBlocker(blocker.id)} onClick={() => removeBlocker(blocker.id)}>{copy.remove}</button>
                        </>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={blockedBy(current(), props.todos.all()).length > 0}>
                  <div class="todo-dependencies">
                    <p class="light">{copy.blocks}</p>
                    <For each={blockedBy(current(), props.todos.all())}>{(blocked) => <TodoLine todo={blocked} />}</For>
                  </div>
                </Show>
                <BlockerMenu
                  open={offering()}
                  onOpenChange={setOffering}
                  others={offeredAsBlockers(answered() ?? current(), props.todos.all())}
                  buttonRef={(element) => { blockerButton = element; }}
                  onPick={(id) => { blockerButton?.focus(); addBlocker(id); }}
                />
                <Show when={blockerForm()}><p><button data-button="quiet" class="word" type="button" onClick={() => void saveBlockers()}>{copy.save}</button></p></Show>
                <Show when={!props.recovery}><TodoComments id={props.id} saved={saved} onSaved={clearFailure} onSent={props.onComment} /></Show>
                <Show when={!props.recovery}><TodoHistory id={props.id} saved={saved} onCapture={setCaptured} /></Show>
              </>
            )}
          </Show>
      </div>
      <TodoDraftRecovery object={String(props.id)} saved={saved} active inDrawer />
      <Show when={todo()}>
        <IconButton class="todo-delete" aria-label={copy.deleteTodo}
          disabled={deleting()}
          onClick={() => {
            if (deleting()) return;

            if (drafts.todoUndo.pending() || drafts.todoUndo.uncertain()) {
              setDeleteRefused(count => count + 1);

              return;
            }

            setDeleteRefused(0);
            const id = props.id;
            const opening = drawer.content();
            setDeleting(true);
            void drafts.todoUndo.remove([id], `todo:${id}`).then(removed => {
              if (removed) { setRemovedByMe(true);

 if (drawer.content() === opening) drawer.close("key"); }
              else if (!drafts.todoUndo.uncertain()) setFailure(drafts.todoUndo.failure());
              setDeleting(false);
            });
          }}>
          <Icon name="trash" />
        </IconButton>
      </Show>
    </>
  );
};

todoEditor.set(TodoDrawer);

/** The Todo's Drawer with the shared list the Shelf reads (U15); it lives while the Drawer does. */
export const TodoHost = (props: { id: number }) => <TodoDrawer id={props.id} todos={useTodoList()} />;

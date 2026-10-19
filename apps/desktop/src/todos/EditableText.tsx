import { copy } from "../copy";
import * as v from "valibot";
import type { Todo } from "@contracts/todo/Todo";
import { DraftRecoveryEntry } from "../drawer/DrawerHost";
import type { Change } from "@contracts/todo/Change";
import { useConnectedProject } from "../state/connectedProject";
import { outcomeOf } from "./failureOf";
import { ErrorLine } from "../ink/ErrorLine";
import { batch, createEffect, createSignal, For, onCleanup, Show } from "solid-js";

const formSchema = v.strictObject({ text: v.string(), base: v.string(), expected_change: v.nullable(v.number()), title: v.string(), body: v.string(), blockers: v.array(v.string()), done: v.boolean() });

const creationSchema = v.strictObject({ title: v.string(), home: v.nullable(v.string()) });

const blockerSchema = v.strictObject({
  title: v.string(), body: v.string(), done: v.boolean(), blockers: v.array(v.string()), baseBlockers: v.array(v.string()), expected_change: v.nullable(v.number()),
  originalTitle: v.string(), originalBody: v.string(), originalDone: v.boolean(), originalBlockers: v.array(v.string()), originalChange: v.nullable(v.number()),
  action: v.picklist(["add", "remove"]), blocker: v.number(),
});

// Shared recovery also retains older title/text/choice snapshots for inspection, without an editable base.
const snapshotSchema = v.strictObject({ title: v.string(), body: v.optional(v.string()), choices: v.optional(v.array(v.string())) });

export const todoDraftSchema = v.union([creationSchema, formSchema, blockerSchema, snapshotSchema]);

type Editing = { form: v.InferOutput<typeof formSchema>; text: string; width: number; recovered: boolean; selection: { start: number; end: number; direction: "forward" | "backward" | "none" } | null };

/** Surface actions share the Project authority; selecting/copying an older revision never changes the editor. */
export const TodoDraftRecovery = (props: { object: string; active?: boolean; inDrawer?: boolean; onDiscard?: (revision: string) => void }) => {
  const { drafts, project, drawer } = useConnectedProject();
  const [failure, setFailure] = createSignal<string | null>(null);
  const surface = copy.draftSurface("todos");
  const records = () => drafts.recoverable().filter(draft => draft.destination.surface === "todos" && draft.destination.object === props.object);

  const problem = () => {
    if (!props.active && records().length === 0) return null;

    const found = drafts.problem();

    return found?.destination && found.destination.surface !== "todos" ? null : found;
  };

  const copyDraft = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setFailure(null); }
    catch (error) { if (!(error instanceof Error)) throw error; setFailure(copy.copyDraftFailure(error.message)); }
  };

  return <Show when={!drawer.content() || props.inDrawer}><section class="todo-draft-recovery" aria-label={copy.draftIdentity(surface, props.object)} onMouseDown={event => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  }}>
    <Show when={problem()}>{problem => <ErrorLine message={copy.draftRetention(project.path, copy.draftIdentity(surface, problem().destination?.object ?? props.object), problem().cause)} />}</Show>
    <Show when={failure()}>{message => <ErrorLine message={message()} />}</Show>
    <Show when={problem()}><button data-button="quiet" class="word" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button></Show>
    <Show when={records().length}><DraftRecoveryEntry /></Show>
    <For each={records().map(draft => draft.revision)}>{revision => {
      const draft = () => records().find(record => record.revision === revision);

      return <Show when={draft()}>{record => <div class="todo-draft-revision">
        <span id={`todo-context-${revision}`} class="todo-draft-label">{copy.draftField(record().destination.object === "new" ? "title" : record().destination.recipient?.startsWith("blockers:") ? "blockers" : record().destination.recipient ?? "title")}{" · "}{String(record().value.text ?? record().value.title ?? "").slice(0, 48)}</span>
        <span id={`todo-revision-${revision}`} data-state={record().status}>{copy.draftStatus[record().status]}</span>
        <div class="todo-draft-actions">
        <button data-button="quiet" class="word" type="button" aria-describedby={`todo-revision-${revision} todo-context-${revision}`} onClick={() => {
          const text = v.safeParse(v.string(), record().value.text ?? record().value.title);
          void copyDraft(!record().destination.recipient?.startsWith("blockers:") && text.success ? text.output : JSON.stringify(record().value));
        }}>{copy.copyField(surface)}</button>{" "}
        <button data-button="quiet" class="word" type="button" aria-describedby={`todo-revision-${revision} todo-context-${revision}`} onClick={() => { props.onDiscard?.(revision); drafts.discard(revision); }}>{copy.discardRevision}</button>
        </div>
      </div>}</Show>;
    }}</For>
  </section></Show>;
};

/**
 * Double-click edits; leaving the field commits once, and only when the text differs from what the field started
 * with, so another Actor's change made meanwhile is never written back. A failed commit reopens the field with
 * the typed text.
 */
export const EditableText = (props: {
  todo: Todo;
  captured: () => Change | undefined;
  multiline: boolean;
  name: "title" | "body";
  onFailure?: (message: string | null) => void;
  /** Resolves only after acknowledgement; the RPC error preserves refusal versus unknown acceptance. */
  commit: (text: string, expectedChange: number) => Promise<void>;
}) => {
  const connected = useConnectedProject();
  const draftDestination = { surface: "todos", object: String(props.todo.id), recipient: props.name };
  const records = () => connected.drafts.list().filter(draft => draft.destination.surface === "todos" && draft.destination.object === String(props.todo.id) && draft.destination.recipient === props.name);
  const [failure, setFailure] = createSignal<string | null>(null);
  const content = connected.drawer.content();
  let alive = true;
  onCleanup(() => { alive = false; });
  const [editing, setEditing] = createSignal<Editing | null>(null);

  const [activeRevision, setActiveRevision] = createSignal<string | null>(null);

  createEffect(() => {
    const revision = activeRevision();

    if (editing() !== null && revision !== null && !records().some(record => record.revision === revision)) setEditing(null);
  });

  createEffect(() => {
    if (editing() && connected.drawer.content() === content) onCleanup(connected.drafts.editor(draftDestination));
  });
  createEffect(() => props.onFailure?.(failure()));

  let shown: HTMLParagraphElement | undefined;

  const startWith = (width = shown?.getBoundingClientRect().width ?? 0) => {
    const saved = records().findLast(draft => draft.status === "draft" || draft.status === "failed");
    const parsed = v.safeParse(formSchema, saved?.value);

    if (saved && !parsed.success) {
      setFailure(copy.draftRetention(connected.project.path, copy.draftSurface("todos"), "invalid"));

      return;
    }

    const change = props.captured();
    const values = change?.after ?? props.todo;

    const form = parsed.success ? parsed.output : { text: values[props.name], base: values[props.name], expected_change: change?.seq ?? null,
      title: values.title, body: values.body, blockers: values.blockers.map(String), done: values.done };

    setActiveRevision(saved?.revision ?? null);
    setEditing({ form, text: form.text, width, recovered: parsed.success, selection: saved?.selection ?? null });
  };

  const fit = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  let save: (() => Promise<void>) | undefined;
  let key: ((event: KeyboardEvent) => void) | undefined;

  const field = (started: Editing) => (element: HTMLTextAreaElement) => {
    element.value = started.text;
    // Fitted again once attached: `scrollHeight` is 0 before then.
    queueMicrotask(() => {
      fit(element);

      if (!alive) return;
      element.focus({ preventScroll: true });

      if (started.selection) element.setSelectionRange(started.selection.start, started.selection.end, started.selection.direction);
    });

    const retain = () => batch(() => {
      const value = { ...started.form, text: element.value };
      const selection = { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection };
      const latest = records().findLast(record => record.revision === activeRevision() || record.status === "draft");

      if (latest && JSON.stringify(latest.value) === JSON.stringify(value) && (latest.status === "failed" || JSON.stringify(latest.selection) === JSON.stringify(selection))) {
        setActiveRevision(latest.revision);
        if (JSON.stringify(latest.selection) !== JSON.stringify(selection)) connected.drafts.setSelection(latest.revision, selection);

        return { draft: latest, problem: connected.drafts.problem() };
      }

      const retained = connected.drafts.edit(draftDestination, value, selection, "ordinary");

      setActiveRevision(retained.draft.revision);

      return retained;
    });

    // Delayed selection events from an editor that closed must not resurrect a discarded revision.
    let left = false;
    onCleanup(() => { left = true; });
    element.addEventListener("select", () => { if (!left && element.isConnected && (element.value !== started.form.base || started.recovered)) retain(); });
    element.addEventListener("input", () => {
      if (left) return;

      if (!props.multiline && element.value.includes("\n")) element.value = element.value.replace(/\r?\n/g, " ");

      fit(element);
      retain();
    });

    const submit = async () => {
      if (left) return;
      left = true;

      if (element.value === started.form.base && !started.recovered) {
        setEditing(null);

        return;
      }

      const draft = retain().draft;

      if (started.form.expected_change === null) {
        setFailure(copy.originalUnverified);
        left = false;

        return;
      }

      connected.drafts.submit(draft.revision);
      setEditing(null);

      try {
        await props.commit(element.value, started.form.expected_change);
        connected.drafts.settle(draft.revision, "acknowledged");
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        connected.drafts.settle(draft.revision, outcomeOf(error));

        if (alive) {
          setFailure(error.message);

          if (outcomeOf(error) === "failed" && connected.drawer.content() === content && editing() === null && !records().some(record => record.status === "draft")
            && (document.activeElement === null || document.activeElement === document.body)) startWith(started.width);
        }
      }
    };

    key = event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();

        if (element.value !== started.form.base || started.recovered) retain();
        left = true; setEditing(null);
        queueMicrotask(() => shown?.focus());
      } else if (event.key === "Enter" && (!props.multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault(); void submit();
      }
    };

    element.addEventListener("blur", event => {
      if (left) return;

      if (element.value !== started.form.base || started.recovered) retain();
      const target = event.relatedTarget;
      queueMicrotask(() => {
        if (!alive || connected.drawer.content() !== content || started.recovered
          || (target instanceof Element && (target.closest(".close, .todo-draft-recovery") || !target.closest(".drawer")))) return;
        void submit();
      });
    });
    // Explicit Save authorizes restored work; restoration alone never resumes blur submission.
    save = submit;

  };

  return (
    <div class="todo-editable">
    <Show when={!props.onFailure && failure()}>{message => <ErrorLine message={message()} />}</Show>
    <Show
      when={editing()}
      fallback={
        <p
          ref={(element) => { shown = element; }}
          tabIndex={0}
          onDblClick={() => startWith()}
          onKeyDown={(key) => {
            if (key.key === "Enter") startWith();
          }}
          style={{ "white-space": "pre-wrap", "overflow-wrap": "anywhere", "min-height": "1.4em", "flex-shrink": props.multiline ? "0" : "1" }}
        >
          <Show when={props.todo[props.name] !== ""} fallback={<span class="light">{copy.noField(props.name)}</span>}>
            {props.todo[props.name]}
          </Show>
        </p>
      }
      keyed
    >
      {(started) => (<>
        <Show when={props.captured() && props.captured()?.seq !== started.form.expected_change}><ErrorLine message={copy.changedTodo(props.todo.title)} /></Show>
        <textarea
          ref={field(started)}
          aria-label={props.name === "title" ? copy.title : copy.body}
          rows={1}
          onKeyDown={event => key?.(event)}
          style={{
            display: "block",
            font: "inherit",
            "letter-spacing": "inherit",
            "line-height": "inherit",
            color: "inherit",
            "text-align": "inherit",
            "white-space": "pre-wrap",
            "overflow-wrap": "anywhere",
            padding: "0",
            margin: "0",
            border: "0",
            "box-sizing": "content-box",
            width: started.width > 0 ? `${started.width}px` : "100%",
            "flex-shrink": "0",
            "min-height": "1.4em",
            resize: "none",
            overflow: "hidden",
            outline: "none",
            background: "var(--hover)",
            "caret-color": "var(--accent)",
          }}
        />
      </>)}
    </Show>
    <Show when={editing()}><button data-button="quiet" class="word" type="button" onMouseDown={event => event.preventDefault()} onClick={() => void save?.()}>{copy.save}</button></Show>
    </div>
  );
};

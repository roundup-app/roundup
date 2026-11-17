import { bindLayer } from "@ui-sdk/core";
import { outcomeOf } from "../app/seam";
import { applying } from "../app/pending";
import { captureFocus } from "../keys/focus";
import { queueFocus } from "../keys/focus";
import { CopyButton } from "../ui/CopyButton";
import { Editable } from "../ui/Editable";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import * as v from "valibot";
import type { Todo } from "@contracts/todo/Todo";
import type { Change } from "@contracts/todo/Change";
import { useConnectedProject } from "../state/connectedProject";
import { createDraftField, type Sent } from "../state/draftField";
import { doesClearTodoFailure } from "../app/failureOf";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import { createMessageToast } from "../ink/messageToast";
import { createEffect, createMemo, createSignal, For, lazy, Loading, onCleanup, Show, untrack } from "solid-js";

import type { PadEditorHandle } from "../pads/PadRichEditor";
import "../pads/styles.css";

const PadRichEditor = lazy(() => import("../pads/PadRichEditor"));

export const formSchema = v.strictObject({ text: v.string(), base: v.string(), home: v.optional(v.nullable(v.string()), null), expected_change: v.nullable(v.number()), title: v.string(), body: v.string(), blockers: v.array(v.string()), done: v.boolean() });

export const creationSchema = v.strictObject({ title: v.string(), home: v.nullable(v.string()), owner: v.optional(v.nullable(v.string()), null) });

export const blockerSchema = v.strictObject({
  title: v.string(), body: v.string(), done: v.boolean(), blockers: v.array(v.string()), baseBlockers: v.array(v.string()), expected_change: v.nullable(v.number()),
  home: v.optional(v.nullable(v.string()), null), originalTitle: v.string(), originalBody: v.string(), originalDone: v.boolean(), originalBlockers: v.array(v.string()), originalChange: v.nullable(v.number()),
  action: v.picklist(["add", "remove"]), blocker: v.number(),
});

// Shared recovery also retains older title/text/choice snapshots for inspection, without an editable base.
export const commentSchema = v.strictObject({ text: v.string() });

const snapshotSchema = v.strictObject({ title: v.string(), body: v.optional(v.string()), choices: v.optional(v.array(v.string())) });

export const todoDraftSchema = v.union([creationSchema, formSchema, blockerSchema, snapshotSchema, commentSchema]);

type Editing = { form: v.InferOutput<typeof formSchema>; text: string; recovered: boolean; selection: { start: number; end: number; direction: "forward" | "backward" | "none" } | null };

/** Leaving toward a Close, recovery or navigation control, or out of the Drawer, keeps the draft without sending it. */
const keepsDraft = (target: EventTarget | null) => target instanceof Element && (!!target.closest(".close, .todo-draft-recovery, [data-dismiss-failure], [data-todo-navigation]") || !target.closest(".drawer"));

/** A failure carries the save count it belongs to and hides once that count moves on. */
export const createSavedFailure = (count: () => number): [() => string | null, (message: string | null) => void] => {
  const [kept, keep] = createSignal<{ message: string; saved: number } | null>(null);

  const shown = () => {
    const current = kept();

    return current && current.saved === count() ? current.message : null;
  };

  return [shown, message => keep(message === null ? null : { message, saved: count() })];
};

export type Unapplied = Extract<Sent<unknown>, { kind: "refused" | "unknown" }>;

/** What the user reads when a send ends without its change applied. */
export const sentFailure = (sent: Unapplied) => sent.kind === "refused" ? sent.error.message : copy.draftStatus.unknown;

/** Surface actions share the Project authority; selecting/copying an older revision never changes the editor. */
export const TodoDraftRecovery = (props: { object: string; active?: boolean; inDrawer?: boolean; saved?: () => number; onDiscard?: (revision: string) => void }) => {
  const { app, drafts, project, drawer, events } = useConnectedProject();
  const [failure, setFailure] = createSavedFailure(() => props.saved?.() ?? 0);
  onCleanup(events.subscribe(event => {
    if (doesClearTodoFailure(event, Number(props.object))) setFailure(null);
  }));
  const surface = copy.draftSurface("todos");
  const records = () => drafts.recoverable().filter(draft => draft.destination.surface === "todos" && draft.destination.object === props.object);

  const problem = () => {
    if (!props.active && records().length === 0) return null;

    const found = drafts.problem();

    return found?.destination && found.destination.surface !== "todos" ? null : found;
  };

  const problemLine = dismissable(() => problem() ? copy.draftRetention(project.name, copy.draftSurface(surface), problem()!.cause) : null);

  const label = (draft: ReturnType<typeof drafts.list>[number]) => copy.draftIdentity(
    draft.destination.recipient === "comment" ? copy.comment : copy.draftField(draft.destination.object === "new" ? "title" : draft.destination.recipient?.startsWith("blockers:") ? "blockers" : draft.destination.recipient ?? "title"),
    String(draft.value.text ?? draft.value.title ?? "").slice(0, 48),
  );

  const line = {
    get message() { return failure() ?? problemLine.message(); },
    get status() { return records().length > 0 ? label(records()[records().length - 1]!) : null; },
    dismiss: () => failure() ? setFailure(null) : problemLine.dismiss(),
    get recover() { return problem() ? { run: () => drafts.retry(), label: copy.storageRetry } : undefined; },
    get action() { return <>
    <For each={records().map(draft => draft.revision)}>{revision => {
      const draft = () => records().find(record => record.revision === revision);

      return <Show when={draft()}>{record => <div class="todo-draft-revision">
        <span id={`todo-context-${revision}`} class="todo-draft-label" hidden>{label(record())}</span>
        <span id={`todo-revision-${revision}`} data-state={record().status}>{copy.draftStatus[record().status]}</span>
        <div class="todo-draft-actions">
        <CopyButton app={app} identity={revision} class="word" aria-describedby={`todo-revision-${revision} todo-context-${revision}`}
          text={(() => {
            const text = v.safeParse(v.string(), record().value.text ?? record().value.title);

            return !record().destination.recipient?.startsWith("blockers:") && text.success ? text.output : JSON.stringify(record().value);
          })()} onSuccess={() => setFailure(null)} onFailure={error => setFailure(copy.copyDraftFailure(error.message))}>{copy.copyField(surface)}</CopyButton>{" "}
        <button data-button="quiet" class="word" type="button" aria-describedby={`todo-revision-${revision} todo-context-${revision}`} onClick={() => { props.onDiscard?.(revision); drafts.discard(revision); }}>{copy.discardRevision}</button>
        </div>
      </div>}</Show>;
    }}</For>
    </>; },
  };

  // U7310d: in the Drawer a failure is a toast and the kept drafts stay a line at the view's end; beside the list both share one line.
  createMessageToast({ get message() { return props.inDrawer && line.message; }, dismiss: line.dismiss, get recover() { return line.recover; } });

  return <Show when={props.inDrawer ? line.status : !drawer.content()}><section class="todo-draft-recovery" data-in-drawer={props.inDrawer ? "" : undefined} aria-label={copy.draftIdentity(surface, props.object)} onMouseDown={event => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  }}>
    <ReservedLine overlay={!props.inDrawer && props.object !== "new"} {...line} message={!props.inDrawer && line.message} />
  </section></Show>;
};

/** U7310d: a change made elsewhere to the field being edited is a status above it while it holds; a toast holds failures only. */
const ChangedElsewhere = (props: { editing: Editing | null; captured: Change | undefined; revision: string | undefined; todo: Todo; name: "title" | "body" }) =>
  <Show when={props.editing}>{started => <Show when={(props.captured && props.captured.seq !== started().form.expected_change) || (props.revision !== undefined && props.todo[props.name] !== started().form.base)}><ReservedLine status={copy.changedTodo(props.todo.title)} /></Show>}</Show>;

/** The form a new edit starts from: the captured change's values, else the Todo's own. */
const formFrom = (todo: Todo, name: "title" | "body", change: Change | undefined): Editing["form"] => {
  const values = change?.after ?? todo;

  return { text: values[name], base: values[name], expected_change: change?.seq ?? null,
    home: todo.home, title: values.title, body: values.body, blockers: values.blockers.map(String), done: values.done };
};

/**
 * Double-click edits; leaving the field commits once, and only when the text differs from what the field started
 * with, so another Actor's change made meanwhile is never written back. A failed commit reopens the field with
 * the typed text.
 */
export const EditableText = (props: {
  todo: Todo;
  captured: () => Change | undefined;
  /** A validated retained revision in this original Todo and field. */
  revision?: string | undefined;
  multiline: boolean;
  name: "title" | "body";
  saved?: () => number;
  onSaved?: () => void;
  onFailure?: (message: string | null, dismiss: () => void) => void;
  /** Resolves only after acknowledgement; the RPC error preserves refusal versus unknown acceptance. */
  commit: (text: string, expectedChange: number) => Promise<void>;
}) => {
  const connected = useConnectedProject();
  // The Drawer keys its body by Todo, so the field's destination and retained revision never change.
  const draftDestination = untrack(() => ({ surface: "todos", object: String(props.todo.id), recipient: props.name }));
  const draft = createDraftField(connected.drafts, draftDestination, formSchema, untrack(() => props.revision === undefined ? undefined : { revision: props.revision }));
  const [failure, setFailure] = createSavedFailure(() => props.saved?.() ?? 0);

  const freshForm = () => formFrom(props.todo, props.name, props.captured());

  /** What opening an edit now gives: the form to edit, or why the retained work cannot be reopened. */
  const opening = (): { failure: string; editing: null } | { failure: null; editing: Editing } => {
    captureFocus(true);

    // A selected revision reopens whatever its status; otherwise only work still the user's to edit.
    const followed = draft.draft();
    const saved = props.revision !== undefined || followed?.status === "draft" || followed?.status === "failed" ? followed : undefined;
    const parsed = draft.value();

    if (saved && !parsed.success) return { failure: copy.draftRetention(connected.project.name, copy.draftSurface("todos"), "invalid"), editing: null };
    const form = saved && parsed.success ? parsed.output : freshForm();

    return { failure: null, editing: { form, text: form.text, recovered: saved !== undefined, selection: saved?.selection ?? null } };
  };

  const opened = untrack(() => props.revision === undefined ? undefined : opening());
  const [retentionFailure, setRetentionFailure] = createSignal<string | null>(opened?.failure ?? null);
  onCleanup(connected.events.subscribe(event => {
    if (doesClearTodoFailure(event, props.todo.id)) setFailure(null);
  }));
  const content = untrack(connected.drawer.content);
  let alive = true;
  onCleanup(() => { alive = false; });
  const [editing, setEditing] = createSignal<Editing | null>(opened?.editing ?? null);
  const [typed, setTyped] = createSignal(opened?.editing?.form.text ?? "");

  createEffect(createMemo(() => editing() !== null && connected.drawer.content() === content), active => active ? connected.drafts.editor(draftDestination) : undefined);
  createEffect(failure, message => { untrack(() => props.onFailure?.(message, () => setFailure(null))); });

  let container: HTMLDivElement | undefined;
  const shown = () => container?.querySelector<HTMLElement>("p[tabindex], .todo-add-notes, .ProseMirror");
  let savedFocus: ReturnType<typeof captureFocus> | undefined;
  createEffect(createMemo(() => props.todo[props.name]), () => {
    const focus = savedFocus;

    if (props.name === "body") return;

    savedFocus = undefined;

    // The value change can run before Solid replaces Add notes with the saved prose.
    queueMicrotask(() => {
      if (alive && (document.activeElement === document.body || document.activeElement === shown()) && connected.drawer.content() === content) focus?.(() => shown()?.focus());
    });
  }, { defer: true });

  const startWith = () => {
    const next = opening();

    setRetentionFailure(next.failure);

    if (next.editing === null) return;

    setTyped(next.editing.form.text);
    setEditing(next.editing);
  };

  /** An acknowledged save clears the failure; when focus fell to the page, it returns to the shown text. */
  const acknowledge = (restoreFocus: boolean | undefined, retryFocus: ReturnType<typeof captureFocus>) => {
    if (!alive) return;
    setFailure(null); props.onSaved?.();

    // A first body save replaces Add notes with prose after acknowledgement.
    if (restoreFocus && document.activeElement === document.body && connected.drawer.content() === content) retryFocus(() => shown()?.focus());
  };

  /** A save that did not apply shows why; a refused one reopens the field with its text, unless newer work took its place. */
  const refuse = (sent: Unapplied, retryFocus: ReturnType<typeof captureFocus>) => {
    savedFocus = undefined;

    if (!alive) return;
    setFailure(sentFailure(sent));

    if (sent.kind === "refused" && outcomeOf(sent.error) === "failed" && connected.drawer.content() === content && editing() === null && draft.draft()?.status === "failed"
      && (document.activeElement === null || document.activeElement === document.body || document.activeElement === shown())) retryFocus(startWith);
  };

  let save: (() => Promise<void>) | undefined;
  let key: ((event: KeyboardEvent) => void) | undefined;

  const bind = (started: Editing, element: HTMLElement, read: () => string, selection: () => Editing["selection"], focusField: () => void, yieldFocus?: () => void) => {
    const focus = captureFocus();
    queueMicrotask(() => { if (alive && !focus(focusField)) yieldFocus?.(); });

    const retain = (selectionChanged = false) => {
      const selected = selection();

      const kept = draft.keep({ ...started.form, text: read() }, selected);

      // A selected revision takes a moved caret only from the selection itself.
      if (props.revision === undefined || selectionChanged) draft.select(selected);

      return kept;
    };

    // Delayed selection events from an editor that closed must not resurrect a discarded revision.
    let left = false;
    const select = () => { if (!left && element.isConnected && (props.revision === undefined || document.activeElement === element) && (read() !== started.form.base || started.recovered)) retain(true); };

    const input = () => { if (!left) retain(); };

    const submit = async (destination?: EventTarget | null) => {
      if (left) return;
      left = true;

      if (read() === started.form.base && !started.recovered) {
        setEditing(null);

        return;
      }

      const kept = retain();

      if (started.form.expected_change === null) {
        setFailure(copy.originalUnverified);
        left = false;

        return;
      }

      const submittedValue = read();
      const expected = started.form.expected_change;
      const { status } = kept;
      const unsendable = copy.draftStatus[status];

      if (status !== "draft" && status !== "failed") {
        setFailure(unsendable);
        left = false;

        return;
      }

      // Save, Enter and blur are the user's Save: the field sends only now.
      draft.save();
      const commit = props.commit;
      const committing = () => applying(() => commit(submittedValue, expected));
      const sending = draft.send(committing);

      const restoreFocus = element.parentElement?.contains(document.activeElement)
        || (destination instanceof Node && element.parentElement?.contains(destination));

      setEditing(null);
      const retryFocus = captureFocus();

      if (restoreFocus) {
        savedFocus = captureFocus();
        queueFocus(() => shown()?.focus());
      }

      const sent = await sending;

      if (sent.kind === "skipped") {
        setFailure(unsendable);
        left = false;

        return;
      }

      if (sent.kind === "applied") acknowledge(restoreFocus, retryFocus);
      else refuse(sent, retryFocus);
    };

    key = event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();

        if (read() !== started.form.base || started.recovered) retain();
        left = true; setEditing(null);
        queueFocus(() => shown()?.focus());
      } else if (event.key === "Enter" && (!props.multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault(); void submit();
      }
    };

    const blur = (target: EventTarget | null) => {
      if (left) return;

      if (read() !== started.form.base || started.recovered) retain();
      queueMicrotask(() => {
        if (!alive || connected.drawer.content() !== content || started.recovered
          || keepsDraft(target)) return;
        void submit(target);
      });
    };

    // Explicit Save authorizes restored work; restoration alone never resumes blur submission.
    save = submit;

    return { retain, blur, select, input, submit, release: () => { left = true; }, keep: () => { if (!left && (read() !== started.form.base || started.recovered)) retain(); } };
  };

  const TitleField = () => {
    let input: HTMLTextAreaElement | undefined;
    let binding: ReturnType<typeof bind> | undefined;

    /** A press or a focus move away from the title saves it, unless the work is restored or the target is one that keeps a draft: those leave it open, kept. */
    const leave = (target: EventTarget | null) => {
      if (editing()?.recovered || keepsDraft(target)) return void binding?.keep();

      void save?.();
    };

    const cancel = () => {
      binding?.keep();
      setEditing(null);
      queueFocus(() => shown()?.focus());
    };

    createEffect(editing, started => {
      if (!started || !input) return;
      // The user's own event started this edit, so any later choice outranks it. The shown title gives up focus now, as the
      // title a field replaced did; an outranked editor closes before the library focuses its field a frame later.
      shown()?.blur();
      const field = input;

      const bound = bind(started, field, () => field.value, () => ({ start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection }), () => {
        field.focus({ preventScroll: true });

        if (started.selection) field.setSelectionRange(started.selection.start, started.selection.end, started.selection.direction);
      }, () => { if (!started.recovered && editing() === started) setEditing(null); });

      binding = bound;

      // A press outside names its target even when that target takes no focus. It moves focus once this handler has returned, and a refused
      // save reopens the field only if nothing outranks it, so the save starts after that move. Escape out of the field closes it like Escape in it.
      const release = bindLayer(field, { onDismiss: (reason, event) => {
        if (reason === "outside-press") { const target = event.target; setTimeout(() => leave(target)); }
        else if (reason === "escape-key") cancel();
      } });

      return () => { release(); bound.release(); };
    });

    return <Editable.Root edit={editing() !== null} activationMode="none" selectOnFocus={false} value={editing() ? typed() : props.todo[props.name]}
      submitMode="none" onValueChange={({ value }) => setTyped(value)} placeholder={copy.noField(props.name)}
      translations={{ edit: props.todo[props.name] || copy.noField(props.name) }}>
      <Editable.Area style={{ display: "grid", width: "100%" }}>
        <Editable.Preview asChild={preview => <p {...preview()} class={props.todo[props.name] === "" ? "light" : undefined} />} onDblClick={() => { if (!editing()) startWith(); }} onKeyDown={event => { if (event.key === "Enter" && !editing()) startWith(); }}
          style={{ "white-space": "pre-wrap", "overflow-wrap": "anywhere", overflow: "visible", "text-overflow": "clip", "min-height": "1.4em" }} />
        <Editable.Input asChild={field => <textarea {...field()} class="field-inline" rows={1} ref={(element: HTMLTextAreaElement) => { input = element; }} />} spellcheck="false" autocorrect="off" autocapitalize="off"
          class="field-inline" aria-label={copy.title}
          onInput={event => {
            const field = event.currentTarget;

            if (/\n/.test(field.value)) field.value = field.value.replace(/\r?\n/g, " ");
            setTyped(field.value);
            binding?.input();
          }}
          onSelect={() => binding?.select()}
          // A focus move names its target; leaving for nothing (the window, a blur) is not leaving the field.
          onFocusOut={event => { if (event.relatedTarget) leave(event.relatedTarget); }}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.stopPropagation();

              if (!event.isComposing) cancel();
            } else if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void save?.(); }
          }}
          style={{ "letter-spacing": "inherit", "line-height": "inherit", "text-align": "inherit", "white-space": "pre-wrap", "overflow-wrap": "anywhere", "min-height": "1.4em", padding: "0", "border-width": "0", resize: "none", overflow: "hidden", "caret-color": "var(--accent)" }} />
      </Editable.Area>
    </Editable.Root>;
  };

  const RichBody = (rich: { started?: Editing }) => {
    let host: HTMLDivElement | undefined;
    let handle: PadEditorHandle | undefined;
    let binding: ReturnType<typeof bind> | undefined;
    const started = rich.started;
    createEffect(createMemo(() => props.todo.body), text => { if (!started) handle?.setText(text); });

    return <div ref={host} onFocusIn={event => { if (!started && event.target instanceof Element && event.target.matches(".ProseMirror")) startWith(); }} onDblClick={() => { if (!started) startWith(); }} onKeyDown={event => {
      // Crepe dismisses block menus in capture; a no-match slash query has already
      // hidden its menu. Preserve rich drafts, but let an untouched empty body
      // return to Add notes (U3732).
      if (event.key === "Escape" && !(started && started.form.base === "" && !started.recovered && handle?.getText() === "")) { event.preventDefault(); event.stopPropagation(); }
      else if (started) key?.(event);
      else if (event.key === "Enter") { event.preventDefault(); startWith(); }
    }}><Loading><PadRichEditor item="todo" text={started?.text ?? props.todo.body} readonly={false} autofocus={false} initialFocus={started ? captureFocus() : undefined} label={copy.body}
      onChange={() => binding?.retain()}
      onText={() => binding?.retain()}
      onSelection={() => binding?.retain(true)}
      onBlur={target => { if (!(target instanceof Node && host?.contains(target))) binding?.blur(target); }}
      onReady={editor => {
        handle = editor;

        if (!started) {
          const focus = savedFocus;
          savedFocus = undefined;

          if (alive && connected.drawer.content() === content && (document.activeElement === document.body || document.activeElement === shown())) focus?.(() => editor.focus());

          return;
        }

        if (!host) return;
        binding = bind(started, host, () => handle!.getText() ?? started.text, () => handle!.selection(), () => {
          handle!.focus();

          if (started.selection) handle!.restoreSelection(started.selection);
        });
      }} /></Loading></div>;
  };

  // U7310d: a failed save shows as a toast.
  createMessageToast({ get message() { return retentionFailure() || (!props.onFailure && failure()); }, dismiss: () => retentionFailure() ? setRetentionFailure(null) : setFailure(null) });

  return (
    <div class="todo-editable" ref={container}>
    <ChangedElsewhere editing={editing()} captured={props.captured()} revision={props.revision} todo={props.todo} name={props.name} />
    <Show when={props.multiline} fallback={<TitleField />}>
      <Show
        when={editing()}
        fallback={
          <Show
            when={props.todo.body === ""}
            fallback={<RichBody />}
          >
            {/* U3732: an empty body offers its own edit, where the body will read. */}
            <button data-button="quiet" type="button" class="word todo-add-notes" onClick={() => startWith()}>{copy.addNotes}</button>
          </Show>
        }
        keyed
      >
        {(started) => <RichBody started={started} />}
      </Show>
    </Show>
    <Show when={editing()}><BusyButton kind="quiet" class="word" busyLabel={copy.saving} onMouseDown={event => event.preventDefault()} onClick={() => save?.()}>{copy.save}</BusyButton></Show>
    </div>
  );
};

import * as v from "valibot";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { leaderChord } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { USER } from "../pads/owner";
import { failureOf, outcomeOf } from "./failureOf";
import { useTodoList } from "./todoList";
import "./capture.styles.css";

let optimistic = 0;

/** U3713 to U3716: `⌘K T` opens a one-line field. `⏎` files an Unassigned Todo and closes it, `⇧⏎` files and keeps it open, Escape cancels. The row shows before the Daemon answers; a failed create puts the text back with the cause. */
export const Capture = (props: { onFile: (() => void) | undefined }) => {
  const connected = useConnectedProject();
  const todos = useTodoList();
  const [open, setOpen] = createSignal(false);
  const { drafts } = connected;
  const destination = { surface: "capture", object: "todo-capture", recipient: null };
  drafts.validate("capture", v.object({ text: v.string() }));
  drafts.registerRecovery("capture", () => "available");

  const records = () => drafts.list().filter(draft => draft.destination.surface === destination.surface
    && draft.destination.object === destination.object && draft.destination.recipient === null);

  const current = () => {
    const latest = records().at(-1);

    return latest?.status === "draft" || latest?.status === "failed" ? latest : undefined;
  };

  const text = () => {
    const value = v.safeParse(v.string(), current()?.value.text);

    return value.success ? value.output : "";
  };

  const setText = (text: string) => drafts.edit(destination, { text }, input
    ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null, "ordinary");

  const recovered = () => records().filter(draft => draft.revision !== current()?.revision && draft.status !== "pending");

  const retainSelection = () => {
    const draft = current();

    if (draft && input) drafts.setSelection(draft.revision, { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection });
  };

  createEffect(() => {
    if (open()) onCleanup(drafts.editor(destination));
  });
  const [failure, setFailure] = createSignal<string | null>(null);
  let returnTo: Element | null = null;
  let input: HTMLTextAreaElement | undefined;
  let panel: HTMLElement | undefined;

  const show = () => {
    if (open()) return;

    returnTo = document.activeElement;
    setOpen(true);
  };

  const close = () => {
    setOpen(false);

    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
  };

  const discard = () => {
    const draft = current();

    if (draft) drafts.discard(draft.revision);

    close();
  };

  const file = (keepOpen: boolean) => {
    const draft = text();
    const title = draft.trim();
    const revision = current();

    if (title === "" || !revision || !drafts.submit(revision.revision)) return;

    const row: Todo = { id: --optimistic, title, body: "", done: false, blockers: [], blocked: false, created_at: 0, creator: USER, home: null, owner: null };
    const hide = todos.show(row);

    props.onFile?.();

    setText("");

    if (!keepOpen) close();

    void (async () => {
      try {
        await connected.app.rpc("todo.create", { title, body: null, blockers: null });
        drafts.settle(revision.revision, "acknowledged");
        await todos.reload();
        hide();
      } catch (error) {
        hide();

        if (!(error instanceof Error)) throw error;
        drafts.settle(revision.revision, outcomeOf(error));

        // The empty next editor is disposable; a newer nonempty draft stays current.
        if (outcomeOf(error) === "failed" && text() === "") {
          const empty = current();

          if (empty) drafts.discard(empty.revision);
        }

        setFailure(error.message);
        show();
      }
    })();
  };

  registerKeys({ kind: "leader" }, [{ chords: leaderChord("T"), run: show }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [{ chords: ["Escape"], run: discard }]);

  return (
    <Show when={open()}>
      <Dialog.Root open onOpenChange={({ open }) => { if (!open) close(); }}
        initialFocusEl={() => input ?? null}
        finalFocusEl={() => returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : null}
        onEscapeKeyDown={(event) => { event.stopImmediatePropagation(); discard(); }}>
        <Dialog.Content class="capture" aria-label={copy.captureLabel} ref={(element) => {
          panel = element;
          const centre = document.querySelector(".centre")?.getBoundingClientRect();

          if (centre) {
            element.style.setProperty("--capture-left", `${centre.left + centre.width / 2}px`);
            element.style.setProperty("--capture-top", `${centre.top}px`);
            element.style.setProperty("--capture-width", `${centre.width}px`);
          }
        }}>
          <textarea
            class="capture-field"
            rows={1}
            wrap="off"
            aria-label={copy.captureLabel}
            placeholder={copy.capturePlaceholder}
            value={text()}
            ref={(element) => {
              input = element;
              queueMicrotask(() => {
                if (!element.isConnected) return;

                element.focus({ preventScroll: true });
                const caret = current()?.selection;

                if (caret) element.setSelectionRange(caret.start, caret.end, caret.direction);
              });
            }}
            onSelect={retainSelection}
            onKeyUp={retainSelection}
            onClick={retainSelection}
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.isComposing) return;

              event.preventDefault();
              file(event.shiftKey);
            }}
          />
          <Show when={failure()}>{(message) => <ErrorLine message={message()} />}</Show>
          <For each={recovered()}>{draft => <div class="capture-recovery">
            <span class="ink" data-state={draft.status}>{copy.draftStatus[draft.status]}</span>
            <textarea class="capture-field" aria-label={copy.recoveredCaptureDraft} rows={1} readOnly value={String(draft.value.text)} />
            <div class="capture-actions">
            <button data-button="quiet" type="button" onClick={() => { void failureOf(() => navigator.clipboard.writeText(String(draft.value.text))).then(cause => { if (cause) setFailure(copy.copyDraftFailure(cause)); }); }}>{copy.copy}</button>
            <button data-button="quiet" type="button" onClick={() => drafts.discard(draft.revision)}>{copy.discardRevision}</button>
            </div>
          </div>}</For>
          <Show when={drafts.problem()}>{problem => <>
            <ErrorLine message={copy.draftRetention(connected.project.path, copy.leaderShortCapture, problem().cause)} />
            <button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button>
          </>}</Show>
        </Dialog.Content>
      </Dialog.Root>
    </Show>
  );
};

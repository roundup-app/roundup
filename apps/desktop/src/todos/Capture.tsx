import { createSignal, Show } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { leaderChord } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { USER } from "../pads/owner";
import { useTodoList } from "./todoList";
import "./capture.styles.css";

let optimistic = 0;

/** U3713 to U3716: `⌘K T` opens a one-line field. `⏎` files an Unassigned Todo and closes it, `⇧⏎` files and keeps it open, Escape cancels. The row shows before the Daemon answers; a failed create puts the text back with the cause. */
export const Capture = () => {
  const connected = useConnectedProject();
  const todos = useTodoList();
  const [open, setOpen] = createSignal(false);
  const [text, setText] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);
  const [failed, setFailed] = createSignal<string | null>(null);
  let returnTo: Element | null = null;
  let input: HTMLTextAreaElement | undefined;
  let panel: HTMLElement | undefined;

  const show = () => {
    if (open()) return;

    returnTo = document.activeElement;
    setText("");
    setFailure(null);
    setFailed(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);

    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
  };

  const placeBack = (title: string, cause: string) => {
    setFailure(cause);

    if (!open()) {
      show();
      setFailure(cause);
    }

    if (text() === "") setText(title);
    else setFailed(title);
  };

  const file = (keepOpen: boolean) => {
    const title = text().trim();

    if (title === "") return;

    const row: Todo = { id: --optimistic, title, body: "", done: false, blockers: [], blocked: false, created_at: 0, creator: USER, home: null, owner: null };
    const hide = todos.show(row);

    setText("");
    setFailure(null);
    setFailed(null);

    if (!keepOpen) close();

    void (async () => {
      try {
        await connected.app.rpc("todo.create", { title, body: null, blockers: null });
        await todos.reload();
        hide();
      } catch (error) {
        hide();

        if (!(error instanceof Error)) throw error;
        placeBack(title, error.message);
      }
    })();
  };

  registerKeys({ kind: "leader" }, [{ chords: leaderChord("T"), run: show }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [{ chords: ["Escape"], run: close }]);

  return (
    <Show when={open()}>
      <Dialog.Root open onOpenChange={({ open }) => { if (!open) close(); }}
        initialFocusEl={() => input ?? null}
        finalFocusEl={() => returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : null}
        onEscapeKeyDown={(event) => event.stopImmediatePropagation()}>
        <Dialog.Content class="capture" ref={(element) => { panel = element; }}>
          <textarea
            class="capture-field"
            rows={1}
            aria-label={copy.captureLabel}
            placeholder={copy.capturePlaceholder}
            value={text()}
            ref={(element) => { input = element; queueMicrotask(() => element.isConnected && element.focus({ preventScroll: true })); }}
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.isComposing) return;

              event.preventDefault();
              file(event.shiftKey);
            }}
          />
          <Show when={failure()}>{(message) => <ErrorLine message={message()} />}</Show>
          <Show when={failed()}>{(title) => <button data-button="quiet" type="button" onClick={() => { setText(title()); setFailed(null); input?.focus(); }}>{copy.useFailedText}</button>}</Show>
        </Dialog.Content>
      </Dialog.Root>
    </Show>
  );
};

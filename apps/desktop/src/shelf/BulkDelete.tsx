import { copy } from "../copy";
import { createContext, createEffect, createMemo, createSignal, For, on, onCleanup, Show, useContext } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { ErrorLine } from "../ink/ErrorLine";

export const ShelfActions = createContext<{ mount: Accessor<HTMLDivElement | undefined>; open: Accessor<boolean> }>();

type Target<Id> = { id: Id; label: string; owner?: string | undefined };

type Question<Id> = { kind: "question" | "pending"; targets: readonly Target<Id>[]; done: boolean; returnTo: HTMLElement | null };

/** U459–U460: one frozen set, one question, and a retained remainder after readback. */
export const createBulkDelete = <Id,>(props: {
  selected: Accessor<readonly Id[]>;
  targets: Accessor<readonly Target<Id>[]>;
  done?: Accessor<readonly Target<Id>[]>;
  context: Accessor<string>;
  noun: "Todos" | "Pads";
  replace: (ids: readonly Id[]) => void;
  clear: () => void;
  cancelSelection: () => void;
  remove: (id: Id) => Promise<string | null>;
  reload: () => Promise<string | null>;
  reveal?: () => void;
}) => {
  const host = useContext(ShelfActions);
  const [question, setQuestion] = createSignal<Question<Id> | null>(null);
  const [failures, setFailures] = createSignal<readonly { target: Target<Id>; message: string }[]>([]);
  const [readFailure, setReadFailure] = createSignal<string | null>(null);
  let readback: (() => Promise<void>) | undefined;
  let revision = 0;
  let deleteButton: HTMLButtonElement | undefined;
  let keep: HTMLButtonElement | undefined;

  const reset = () => {
    revision += 1;
    setQuestion(null);
    setFailures([]);
    setReadFailure(null);
    props.clear();
  };

  createEffect(on(() => `${props.context()}:${host?.open()}`, reset, { defer: true }));
  onCleanup(() => { revision += 1; });
  createEffect(() => {
    const held = question();

    if (held?.kind !== "question") return;
    const eligible = held.done ? props.done?.() ?? [] : props.targets();

    if (held.targets.some((target) => !eligible.some((row) => row.id === target.id))) setQuestion(null);
  });

  const ask = (done = false) => {
    if (question()) return;
    const targets = done ? props.done?.() ?? [] : props.targets().filter((target) => props.selected().includes(target.id));

    if (targets.length === 0) return;
    const unique = [...new Map(targets.map((target) => [target.id, { ...target }])).values()];
    setQuestion({ kind: "question", targets: unique, done, returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null });
    queueMicrotask(() => keep?.focus());
  };

  const cancel = () => {
    const held = question();

    if (held?.kind !== "question") return;
    setQuestion(null);

    if (held.returnTo?.isConnected) held.returnTo.focus();
    else deleteButton?.focus();
  };

  const confirm = async () => {
    const held = question();

    if (held?.kind !== "question") return;
    const mine = revision;
    const eligible = held.done ? props.done?.() ?? [] : props.targets();
    const targets = held.targets.map((target) => ({ ...(eligible.find((row) => row.id === target.id) ?? target) }));
    setQuestion({ ...held, kind: "pending", targets });
    setFailures([]);
    const failed: { target: Target<Id>; message: string }[] = [];

    for (const target of targets) {
      const message = await props.remove(target.id);

      if (message !== null) failed.push({ target, message });
    }

    // A lost response can follow a committed delete; readback precedes retry.
    readback = async () => {
      const message = await props.reload();

      if (mine !== revision) return;
      setReadFailure(message);

      if (message !== null) return;

      if (held.done && failed.length > 0) props.reveal?.();
      const remaining = failed.filter(({ target }) => props.targets().some((row) => row.id === target.id));
      props.replace(remaining.map(({ target }) => target.id));
      setFailures(remaining);
      setQuestion(null);
      readback = undefined;
    };

    await readback();
  };

  const key = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

    if (event.key === "Escape" && (question() || props.selected().length > 0)) {
      event.preventDefault();
      event.stopPropagation();

      if (question()?.kind === "question") cancel();
      else if (!question()) { props.cancelSelection(); setFailures([]); }
    } else if (event.key === "Backspace" && !event.repeat && props.selected().length > 0) {
      event.preventDefault();
      event.stopPropagation();
      ask();
    } else if (event.key === "Enter" && question()?.kind === "question" && !event.repeat) {
      event.preventDefault();
      void confirm();
    }
  };

  createEffect(() => {
    const frame = host?.mount()?.closest(".shelf");

    if (!frame) return;

    const escape = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape" && event.target instanceof Element && !event.target.closest("input, textarea, select, [contenteditable], .todo-blocker")) key(event);
    };

    frame.addEventListener("keydown", escape);
    onCleanup(() => frame.removeEventListener("keydown", escape));
  });

  createEffect(() => {
    if (props.selected().length === 0 && question() === null) setFailures([]);
  });

  const owners = createMemo(() => {
    const held = question();

    const targets = held?.kind === "pending" ? held.targets : props.targets().filter((target) =>
      held ? held.targets.some((row) => row.id === target.id) : props.selected().includes(target.id));

    return [...new Set(targets.flatMap((target) => target.owner ? [target.owner] : []))];
  });

  const content = () => (
    <Show when={question() || props.selected().length > 0 || failures().length > 0}>
      <div class="shelf-bulk" on:keydown={key} role="group" aria-label={copy.shelfDeletion}>
        <div class="shelf-bulk-line">
          <Show when={question()} fallback={<>
            <span>{props.selected().length}{copy.selected}</span>
            <button data-button="quiet" type="button" ref={(button) => { deleteButton = button; }} onClick={() => ask()}>{copy.deleteWord}{props.selected().length}</button>
            <button data-button="quiet" type="button" onClick={() => { props.cancelSelection(); setFailures([]); }}>{copy.cancel}</button>
          </>}>
            {(held) => <>
              <span>{copy.deleteWord}{held().targets.length}{held().done ? copy.doneCount : ""} {props.noun}{copy.questionMark}</span>
              <button data-button="quiet" type="button" disabled={held().kind === "pending"} onClick={() => void confirm()}>{copy.deleteWord}{held().targets.length}</button>
              <button data-button="quiet" type="button" disabled={held().kind === "pending"} ref={(button) => { keep = button; }} onClick={cancel}>{copy.keep}</button>
            </>}
          </Show>
        </div>
        <Show when={owners().length > 0}>
          <p>{copy.ownedBy}{owners().join(", ")}{copy.agentsMayStillBeWritingDeletingDoesNot}</p>
        </Show>
        <Show when={readFailure()}>{(message) => <><ErrorLine message={message()} /><button data-button="quiet" type="button" onClick={() => void readback?.()}>{copy.refresh}</button></>}</Show>
        <Show when={failures().length > 0}>
          <ErrorLine message="Could not delete" />
          <For each={failures()}>{(failure) => <p>{failure.target.label}{copy.colon}{failure.message}</p>}</For>
        </Show>
      </div>
    </Show>
  );

  const Bar = (): JSX.Element => host ? <Show when={host.mount()}>{(mount) => <Portal mount={mount()}>{content()}</Portal>}</Show> : content();

  return { ask, key, Bar, pending: () => question()?.kind === "pending" };
};

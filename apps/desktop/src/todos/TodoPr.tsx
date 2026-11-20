import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import type { PrCheck } from "@contracts/todo/PrCheck";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { Field } from "../ui/Field";
import { createMessageToast } from "../ink/messageToast";
import { useConnectedProject } from "../state/connectedProject";
import { changeFailureOf, doesClearTodoFailure, failureOf } from "../app/failureOf";

/** U7708d: the Todo's pull-request link. A linked, open Todo is read once when the Drawer opens it, and what the Daemon read shows by label; a failed read shows its cause. */
export const TodoPr = (props: { id: number; pr: number | null; done: boolean; onSaved?: () => void }) => {
  const { app, events } = useConnectedProject();
  const id = createMemo(() => props.id);
  const [read, setRead] = createSignal<PrCheck | null>(null);
  const [typed, setTyped] = createSignal("");
  const [bad, setBad] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  // An answer for a link the Todo no longer has is not shown.
  const shown = () => (read()?.pr === props.pr ? read() : null);

  const check = async (todo: number, pr: number) => {
    const message = await failureOf(async () => { setRead(await app.rpc("todo.checkPr", { id: todo })); });

    if (message !== null) setRead({ id: todo, pr, state: "unknown", cause: message });
  };

  // One read per Todo and link, while the Todo is open; a merge's `todo.updated` closes the Todo without a second read.
  createEffect(() => ({ id: id(), pr: props.pr, done: untrack(() => props.done) }), ({ id: todo, pr, done }) => {
    setFailure(null);
    setBad(false);
    setTyped("");

    if (pr !== null && !done) void check(todo, pr);
  });

  // oxlint-disable-next-line solid/reactivity -- an Event handler reads the Todo's id when the Event arrives, as TodoComments does
  onCleanup(events.subscribe((event) => {
    if (doesClearTodoFailure(event, props.id)) setFailure(null);

    if (event.name === "todo.prChecked" && event.data.id === props.id) setRead(event.data);
  }));

  // The form or the Unlink button unmounts on a save; focus moves to its counterpart once the link changes.
  const [refocus, setRefocus] = createSignal<"field" | "unlink" | null>(null);
  let section: HTMLElement | undefined;

  createEffect(() => ({ pr: props.pr, target: refocus() }), ({ target }) => {
    if (target === null) return;

    // Kept until the counterpart is mounted: the save can answer before the Daemon's event changes the link.
    queueMicrotask(() => {
      const next = section?.querySelector<HTMLElement>(target === "field" ? "input" : ".todo-pr-clear");

      if (next === null || next === undefined) return;

      next.focus();
      setRefocus(null);
    });
  });

  const save = async (pr: number | null) => {
    const todo = id();
    const message = await changeFailureOf(async () => { await app.rpc("todo.update", { id: todo, title: null, body: null, pr }); });

    setFailure(message);

    if (message === null) { setRefocus(pr === null ? "field" : "unlink"); props.onSaved?.(); }
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const number = Number(typed().trim());

    if (!Number.isInteger(number) || number < 1) { setBad(true);

 return; }

    setBad(false);

    return save(number);
  };

  createMessageToast({ get message() { return failure(); }, recover: { run: () => save(props.pr === null ? Number(typed().trim()) : null), label: copy.prRetry }, dismiss: () => setFailure(null) });

  const stateLabel = (check: PrCheck) => (check.state === "unknown" ? copy.prUnknown(check.cause ?? "") : copy.prState[check.state]);

  return <section class="todo-pr" ref={section} aria-label={copy.prHeading}>
    <h3>{copy.prHeading}</h3>
    <Show when={props.pr} fallback={
      <form class="todo-pr-form" onSubmit={submit}>
        <Field.Root invalid={bad()}>
          <Field.Label>{copy.prField}</Field.Label>
          <Field.Input type="text" inputmode="numeric" value={typed()} onInput={event => { setTyped(event.currentTarget.value); setBad(false); }} />
          <Show when={bad()}><Field.ErrorText>{copy.prBad}</Field.ErrorText></Show>
        </Field.Root>
        <BusyButton kind="quiet" class="word" type="submit" busyLabel={copy.prLinking}>{copy.prLink}</BusyButton>
      </form>
    }>
      {linked => <><div class="todo-pr-row">
        <span class="todo-pr-number">{copy.prLabel(linked())}</span>
        <BusyButton kind="quiet" class="word todo-pr-clear" busyLabel={copy.prUnlinking} onClick={() => save(null)}>{copy.prUnlink}</BusyButton>
      </div>
      <Show when={shown()}>{current => <div class="todo-pr-state-line">
        <p class="todo-pr-state" data-state={current().state} role="status">{stateLabel(current())}</p>
        <Show when={current().state === "unknown"}>
          <BusyButton kind="quiet" class="word" busyLabel={copy.prReading} onClick={() => check(props.id, linked())}>{copy.prReread}</BusyButton>
        </Show>
      </div>}</Show></>}
    </Show>
  </section>;
};

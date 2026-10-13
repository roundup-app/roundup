import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { History } from "@contracts/todo/History";
import type { Change } from "@contracts/todo/Change";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "./failureOf";

const lines = (change: Change): string[] => {
  const { before, after } = change;
  const text: string[] = [];

  if (!before || before.title !== after.title) text.push(`Title: ${after.title}`);

  if (!before || before.body !== after.body) text.push(`Body: ${after.body || "No body"}`);

  if (!before || before.done !== after.done) text.push(after.done ? "Done" : "Open");
  const added = after.blockers.filter((id) => !before?.blockers.includes(id));
  const removed = before?.blockers.filter((id) => !after.blockers.includes(id)) ?? [];

  if (added.length) text.push(`Waits on: ${added.map((id) => `#${id}`).join(", ")}`);

  if (removed.length) text.push(`Removed blockers: ${removed.map((id) => `#${id}`).join(", ")}`);

  return text;
};

/** History loads only here; its first response captures this opening's unread boundary. */
export const TodoHistory = (props: { id: number }) => {
  const { app, events } = useConnectedProject();
  const [history, setHistory] = createSignal<History | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  let latest = 0;
  let alive = true;
  let boundary: number | null | undefined;
  let through = 0;

  const refresh = async () => {
    const mine = ++latest;
    const id = props.id;

    const message = await failureOf(async () => {
      const fetched = await app.rpc("todo.history", { id });

      if (!alive || mine !== latest || id !== props.id) return;
      const opening = history() === null;

      if (boundary === undefined) boundary = fetched.unread;
      // No unread entries on opening: later changes start the rule after the fetched tail.
      const firstNew = boundary ?? (opening ? null : fetched.changes.find((change) => change.seq > through)?.seq ?? null);

      if (history() === null) through = fetched.changes.at(-1)?.seq ?? 0;
      setHistory({ changes: fetched.changes, unread: boundary === null ? firstNew : boundary ?? null });
      const tail = fetched.changes.at(-1);

      if (tail) await app.rpc("todo.readHistory", { id, through: tail.seq });
    });

    if (alive && mine === latest && id === props.id) setFailure(message);
  };

  createEffect(on(() => props.id, () => {
    boundary = undefined; through = 0; setHistory(null); setFailure(null);
    void refresh();
  }));
  onCleanup(events.subscribe((event) => {
    if ((event.name === "todo.updated" || event.name === "todo.unblocked") && event.data.id === props.id) void refresh();

    // Deleting a blocker changes surviving Todos' history without changing their own fields in this Event.
    if (event.name === "todo.deleted" && event.data.id !== props.id) void refresh();
  }));
  onCleanup(() => { alive = false; latest++; });

  return <section class="todo-history" aria-label="Todo history">
    <h3>Changes</h3>
    <Show when={failure()}>{(message) => <div><ErrorLine message={message()} /><button data-button="quiet" class="word" type="button" onClick={() => void refresh()}>Retry history</button></div>}</Show>
    <Show when={history()}>{(loaded) => <For each={loaded().changes}>{(change) => <>
      <Show when={loaded().unread === change.seq}><hr aria-label="Unread changes" /></Show>
      <div class="todo-change" data-change={change.seq}><For each={lines(change)}>{(line) => <p>{line}</p>}</For></div>
    </>}</For>}</Show>
  </section>;
};

import { copy } from "../copy";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { History } from "@contracts/todo/History";
import type { Change } from "@contracts/todo/Change";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "./failureOf";

const lines = (change: Change, agentName: (id: string) => string): string[] => {
  const { before, after } = change;
  const text: string[] = [];

  if (!before || before.title !== after.title) text.push(copy.titleChange(after.title));

  if (!before || before.body !== after.body) text.push(copy.bodyChange(after.body || copy.noBody));

  if (!before || before.done !== after.done) text.push(after.done ? copy.done : copy.open);
  const added = after.blockers.filter((id) => !before?.blockers.includes(id));
  const removed = before?.blockers.filter((id) => !after.blockers.includes(id)) ?? [];

  if (added.length) text.push(copy.waitsOnJoin(added.map((id) => `#${id}`).join(", ")));

  if (removed.length) text.push(copy.removedBlockersJoin(removed.map((id) => `#${id}`).join(", ")));

  const ownerId = (owner: Change["after"]["owner"]) => (owner ? `${owner.kind}:${owner.id}` : null);

  if (ownerId(before?.owner ?? null) !== ownerId(after.owner) && (before || after.owner)) {
    text.push(copy.ownerChange(!after.owner ? copy.unassigned : after.owner.kind === "agent" ? agentName(after.owner.id) : copy.me));
  }

  return text;
};

/** History loads only here; its first response captures this opening's unread boundary. */
export const TodoHistory = (props: { id: number; onCapture?: (change: Change | undefined) => void }) => {
  const { app, events, drawer, rail } = useConnectedProject();
  const content = drawer.content();
  const [history, setHistory] = createSignal<History | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  let latest = 0;
  let alive = true;
  let boundary: number | null | undefined;
  let through = 0;
  let reading: Promise<null> | null = null;

  const refresh = async () => {
    if (drawer.content() !== content) return;
    const mine = ++latest;
    const id = props.id;

    const message = await failureOf(async () => {
      const fetched = await app.rpc("todo.getHistory", { id });

      if (!alive || mine !== latest || id !== props.id || drawer.content() !== content) return;
      props.onCapture?.(fetched.changes.at(-1));
      const opening = history() === null;

      if (boundary === undefined) boundary = fetched.unread;
      // No unread entries on opening: later changes start the rule after the fetched tail.
      const firstNew = boundary ?? (opening ? null : fetched.changes.find((change) => change.seq > through)?.seq ?? null);

      if (history() === null) through = fetched.changes.at(-1)?.seq ?? 0;
      setHistory({ changes: fetched.changes, unread: boundary === null ? firstNew : boundary ?? null });

      // Only the opening's fetched prefix is a read; a live refresh must leave later changes unread on reopening.
      if (through > 0) {
        reading ??= app.rpc("todo.readHistory", { id, through }).catch((error) => {
          reading = null;
          throw error;
        });
        await reading;
      }
    });

    if (alive && mine === latest && id === props.id && drawer.content() === content) setFailure(message);
  };

  createEffect(on(() => props.id, () => {
    boundary = undefined; through = 0; reading = null; setHistory(null); setFailure(null);
    void refresh();
  }));
  onCleanup(events.subscribe((event) => {
    if ((event.name === "todo.updated" || event.name === "todo.unblocked") && event.data.id === props.id) void refresh();

    // Deleting a blocker changes surviving Todos' history without changing their own fields in this Event.
    if (event.name === "todo.deleted" && event.data.id !== props.id) void refresh();
  }));
  onCleanup(() => { alive = false; latest++; });

  return <section class="todo-history" aria-label={copy.todoHistory}>
    <h3>{copy.changes}</h3>
    <Show when={failure()}>{(message) => <div><ErrorLine message={message()} /><button data-button="quiet" class="word" type="button" onClick={() => void refresh()}>{copy.retryHistory}</button></div>}</Show>
    <Show when={history()}>{(loaded) => <For each={loaded().changes}>{(change) => <>
      <Show when={loaded().unread === change.seq}><hr aria-label={copy.unreadChanges} /></Show>
      <div class="todo-change" data-change={change.seq}><For each={lines(change, (id) => rail.nodes.find((node) => node.id === id)?.name ?? id)}>{(line) => <p>{line}</p>}</For></div>
    </>}</For>}</Show>
  </section>;
};

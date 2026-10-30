import { CopyButton } from "../ui/CopyButton";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "../copy";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { History } from "@contracts/todo/History";
import type { Change } from "@contracts/todo/Change";
import { Icon } from "../ink/Icon";
import { useConnectedProject } from "../state/connectedProject";
import { doesClearTodoFailure, failureOf } from "./failureOf";

const ids = (list: number[]) => [...list].sort((a, b) => a - b).map((id) => `#${id}`).join(", ");

/** U3728: one past-tense line per change made, the actor named only when it is not the user. */
const lines = (change: Change, agentName: (id: string) => string): string[] => {
  const { before, after } = change;
  const text: string[] = [];

  if (!before) text.push(copy.changeCreated(after.title));
  else if (before.title !== after.title) text.push(copy.changeRenamed(after.title));

  if (before ? before.body !== after.body : after.body !== "") text.push(after.body ? copy.changeBodyWritten : copy.changeBodyCleared);

  if (before && before.done !== after.done) text.push(after.done ? copy.changeDone : copy.changeReopened);

  const added = after.blockers.filter((id) => !before?.blockers.includes(id));
  const removed = before?.blockers.filter((id) => !after.blockers.includes(id)) ?? [];

  if (added.length) text.push(copy.changeWaitsOn(ids(added)));

  if (removed.length) text.push(copy.changeStoppedWaitingOn(ids(removed)));

  const ownerId = (owner: Change["after"]["owner"]) => (owner ? `${owner.kind}:${owner.id}` : null);

  if (ownerId(before?.owner ?? null) !== ownerId(after.owner) && (before || after.owner)) {
    text.push(after.owner ? copy.changeAssigned(after.owner.kind === "agent" ? agentName(after.owner.id) : copy.me) : copy.changeUnassigned);
  }

  // T26: a hand-off is the Daemon's, so its line names the Agent handed to, not the writer.
  if (change.handed) text.push(copy.changeHandedTo(agentName(change.handed.id)));

  const actor = change.actor && change.actor.kind !== "user" && !change.handed ? agentName(change.actor.id) : null;

  const named = actor ? text.map((line) => copy.changeByActor(line, actor)) : text;

  // History recorded before the Daemon kept a time has none to show.
  return change.changed_at === null ? named : named.map((line) => copy.changeAt(line, change.changed_at!));
};

type Loaded = { history: History; unread: boolean };

/** History loads with the Drawer, but entries render and the read is sent only once the user opens the line. */
export const TodoHistory = (props: { id: number; saved?: () => number; onCapture?: (change: Change | undefined) => void }) => {
  const { app, events, drawer, rail } = useConnectedProject();
  const content = drawer.content();
  const [loaded, setLoaded] = createSignal<Loaded | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [copyFailure, failCopy] = createSignal<string | null>(null);
  createEffect(on(props.saved ?? (() => 0), () => failCopy(null), { defer: true }));
  const [opened, setOpened] = createSignal(false);
  let latest = 0;
  let alive = true;
  let boundary: number | null | undefined;
  let baseline = 0;
  let through = 0;
  let acknowledged = false;
  let reading: Promise<null> | null = null;

  const unreadIn = (changes: Change[]) => acknowledged ? changes.some((change) => change.seq > through)
    : boundary !== null || changes.some((change) => change.seq > baseline);

  // The opened section reads the entries it shows, once per Drawer.
  const read = async () => {
    const fetched = loaded();
    const id = props.id;

    if (!opened() || !fetched || reading) return;
    through = fetched.history.changes.at(-1)?.seq ?? 0;

    if (through === 0) return;
    reading = app.rpc("todo.readHistory", { id, through }).then(() => null);
    const message = await failureOf(async () => { await reading; });

    if (message !== null) reading = null;
    else if (alive && id === props.id) {
      acknowledged = true;
      const current = loaded();

      if (current) setLoaded({ ...current, unread: unreadIn(current.history.changes) });
    }

    if (alive && id === props.id) setFailure(message);
  };

  const refresh = async () => {
    if (drawer.content() !== content) return;
    const mine = ++latest;
    const id = props.id;

    const message = await failureOf(async () => {
      const fetched = await app.rpc("todo.getHistory", { id });

      if (!alive || mine !== latest || id !== props.id || drawer.content() !== content) return;
      props.onCapture?.(fetched.changes.at(-1));

      if (boundary === undefined) {
        boundary = fetched.unread;
        baseline = fetched.changes.at(-1)?.seq ?? 0;
      }

      setLoaded({ history: fetched, unread: unreadIn(fetched.changes) });
    });

    if (alive && mine === latest && id === props.id && drawer.content() === content) setFailure(message);
    await read();
  };

  createEffect(on(() => props.id, () => {
    boundary = undefined; baseline = 0; through = 0; acknowledged = false; reading = null;
    setLoaded(null); setFailure(null); failCopy(null); setOpened(false);
    void refresh();
  }));
  onCleanup(events.subscribe((event) => {
    if (doesClearTodoFailure(event, props.id)) failCopy(null);

    if ((event.name === "todo.updated" || event.name === "todo.unblocked") && event.data.id === props.id) void refresh();

    // Deleting a blocker changes surviving Todos' history without changing their own fields in this Event.
    if ((event.name === "todo.restored" || event.name === "todo.deleted") && event.data.id !== props.id) void refresh();
  }));
  onCleanup(() => { alive = false; latest++; });

  const toggle = () => {
    const next = !opened();

    setOpened(next);

    if (!next) return;

    // A failed fetch has nothing to read: opening shows its failure and the retry.
    if (loaded()) void read();
  };

  const count = () => loaded()?.history.changes.length ?? 0;

  return <>
    <ReservedLine message={copyFailure() ?? failure()} content={failure() && count() === 0 && !opened() ? <button data-button="quiet" class="word" type="button" aria-expanded={false} onClick={toggle}>{copy.changes}</button> : undefined}>
      <button data-button="quiet" class="word" type="button" onClick={() => void refresh()}>{copy.retryHistory}</button><button data-dismiss-failure onMouseDown={event => event.preventDefault()} data-button="quiet" class="word" type="button" onClick={() => { failCopy(null); setFailure(null); }}>{copy.dismissFailure}</button>
    </ReservedLine>
    <Show when={count() > 0}>
    <section class="todo-history" aria-label={copy.todoHistory}>
      <div class="todo-history-head"><button type="button" class="todo-history-line" data-button="quiet" aria-expanded={opened()} onClick={toggle}>
        <Icon name={opened() ? "down" : "right"} />
        <span class="todo-history-count" data-state={loaded()?.unread ? "unread" : "read"}>{count() > 0 ? copy.changesCount(count()) : copy.changes}</span>
      </button>
      <Show when={opened() && loaded()}>{record => <CopyButton app={app} text={JSON.stringify({
          lines: record().history.changes.flatMap(change => lines(change, id => rail.nodes.find(node => node.id === id)?.name ?? copy.missingAgent)),
          history: record().history, failure: failure(),
        }, null, 2)} onSuccess={() => failCopy(null)} onFailure={error => failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error)))}>{copy.copy}</CopyButton>}</Show></div>
      <Show when={opened()}>

        <For each={loaded()?.history.changes ?? []}>{(change) => <>
          <For each={lines(change, (id) => rail.nodes.find((node) => node.id === id)?.name ?? copy.missingAgent)}>{(line) => <p class="todo-change" data-change={change.seq}>{line}</p>}</For>
        </>}</For>
      </Show>
    </section>
  </Show></>;
};

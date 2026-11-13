import { CopyButton } from "../ui/CopyButton";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import type { Event } from "@contracts/Event";
import type { Change } from "@contracts/todo/Change";

import { useConnectedProject } from "../state/connectedProject";
import { doesClearTodoFailure } from "../app/failureOf";
import { createSavedFailure } from "./EditableText";

const ids = (list: number[]) => [...list].sort((a, b) => a - b).map((id) => `#${id}`).join(", ");

/** U3728: one past-tense line per change made, the actor named only when it is not the user. */
const lines = (change: Change, agentName: (id: string) => string, now: number): string[] => {
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
  return change.changed_at === null ? named : named.map((line) => copy.changeAt(line, copy.commentTime(change.changed_at!, now)));
};

/** Deleting a blocker changes surviving Todos' history without changing their own fields in that Event. */
const changesHistory = (event: Event, id: number) =>
  (event.name === "todo.updated" || event.name === "todo.unblocked") && event.data.id === id
  || (event.name === "todo.restored" || event.name === "todo.deleted") && event.data.id !== id;

/** History loads with the Drawer, but entries render and the read is sent only once the user opens the line. */
export const createTodoHistory = (props: { id: number; saved?: (() => number) | undefined; onCapture?: ((change: Change | undefined) => void) | undefined; exposed: () => boolean }) => {
  const { app, events, drawer, rail, now } = useConnectedProject();
  const content = drawer.content();
  const [copyFailure, failCopy] = createSavedFailure(() => props.saved?.() ?? 0);
  const [history, { refetch }] = createResource(() => props.id, id => app.rpc("todo.getHistory", { id }));
  const loaded = () => history.error || history.state === "pending" ? undefined : history.latest;
  const firstSeq = createMemo<number | null>(previous => previous ?? loaded()?.changes.at(-1)?.seq ?? (loaded() ? 0 : null), null);

  // The opened section reads the entries it showed on opening, once per Drawer: closing it again does not read twice.
  const opened = createMemo(previous => previous || props.exposed() && drawer.content() === content, false);

  const [read, { refetch: reread }] = createResource(
    () => opened() && (firstSeq() ?? 0) > 0 && { id: props.id, through: firstSeq() ?? 0 },
    args => app.rpc("todo.readHistory", args),
  );

  const [dismissed, dismiss] = createSignal<unknown>(null);
  const problem = () => history.error ?? read.error;

  const failure = () => {
    const error: unknown = problem();

    return error && error !== dismissed() ? (error instanceof Error ? error.message : String(error)) : null;
  };

  createEffect(() => {
    const latest = loaded();

    if (latest) props.onCapture?.(latest.changes.at(-1));
  });

  onCleanup(events.subscribe((event) => {
    if (doesClearTodoFailure(event, props.id)) failCopy(null);

    if (changesHistory(event, props.id)) void refetch();
  }));

  return {
    changes: () => loaded()?.changes,
    feedback: <ReservedLine message={copyFailure() ?? failure()} dismiss={() => { failCopy(null); dismiss(problem()); }} recover={{ run: () => { void refetch(); void reread(); }, label: copy.retryHistory }} />,
    copy: <Show when={loaded()}>{record => <CopyButton app={app} text={JSON.stringify({
      lines: record().changes.flatMap(change => lines(change, id => rail.nodes.find(node => node.id === id)?.name ?? copy.missingAgent, now())),
      history: record(), failure: failure(),
    }, null, 2)} onSuccess={() => failCopy(null)} onFailure={error => failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error)))}>{copy.copy}</CopyButton>}</Show>,
    entry: (change: Change) => <div class="todo-change" data-change={change.seq}>
      <span class="todo-activity-dot" aria-hidden="true" />
      <div><For each={lines(change, id => rail.nodes.find(node => node.id === id)?.name ?? copy.missingAgent, now())}>{line => <p>{line}</p>}</For></div>
    </div>,
  };
};

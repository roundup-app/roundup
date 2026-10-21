import { createSignal, For, onCleanup, Show } from "solid-js";
import type { UnreadComment } from "@contracts/todo/UnreadComment";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { leaderChord } from "../keys/chords";
import { activationSource, registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../todos/failureOf";
import { TodoDrawer } from "../todos/TodoDrawer";
import { useTodoList } from "../todos/todoList";
import "./inbox.styles.css";

/** The Todo's Drawer, with the shared list the Shelf reads (U15); it lives while the Drawer does. */
const TodoHost = (props: { id: number }) => <TodoDrawer id={props.id} todos={useTodoList()} />;

const STALE = new Set(["todo.commented", "todo.commentsRead", "todo.deleted"]);

/** One row for each unread Agent comment, driven by `todo.unread` and the Todo events, never by a Message. Opening the row's Todo marks it read (the Todo Drawer), and the row leaves. */
export const Inbox = () => {
  const { app, events, drawer, rail } = useConnectedProject();
  const [rows, setRows] = createSignal<readonly UnreadComment[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  let latest = 0;
  let alive = true;

  const refresh = async () => {
    const mine = ++latest;
    let unread: UnreadComment[] = [];
    const message = await failureOf(async () => { unread = await app.rpc("todo.unread", null); });

    if (!alive || mine !== latest) return;

    if (message === null) setRows(unread);

    setFailure(message);
  };

  void refresh();
  onCleanup(events.subscribe((event) => { if (STALE.has(event.name)) void refresh(); }));
  onCleanup(() => { alive = false; latest++; });

  return <section class="inbox" aria-label={copy.inbox}>
    <h2>{copy.inbox}</h2>
    <Show when={failure()}>{(message) => <div><ErrorLine message={message()} /><button data-button="quiet" class="word" type="button" onClick={() => void refresh()}>{copy.inboxRetry}</button></div>}</Show>
    <Show when={rows().length === 0 && failure() === null}><p class="light">{copy.inboxEmpty}</p></Show>
    <For each={rows()}>{(row) => <button type="button" class="inbox-row" data-comment={row.comment.id}
      onClick={(event) => drawer.open(() => <TodoHost id={row.todo} />, activationSource(event))}>
      <span class="inbox-row-name">{copy.inboxRow(rail.nameOf(row.comment.author), row.title)}</span>
      <span class="inbox-row-line">{row.comment.body}</span>
    </button>}</For>
  </section>;
};

/** `⌘K I` opens the Inbox as the Drawer. */
export const InboxKey = () => {
  const { drawer } = useConnectedProject();

  registerKeys({ kind: "leader" }, [{ chords: leaderChord("I"), run: () => drawer.open(() => <Inbox />, "key") }]);

  return null;
};

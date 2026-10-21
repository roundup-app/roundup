import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Comment } from "@contracts/todo/Comment";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "./failureOf";

/** The thread, oldest first, with a field to add to it. Opening reads it and marks it read once; a comment that arrives while it is open is read the same way. */
export const TodoComments = (props: { id: number }) => {
  const { app, events, rail } = useConnectedProject();
  const [thread, setThread] = createSignal<readonly Comment[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [sendFailure, setSendFailure] = createSignal<string | null>(null);
  const [text, setText] = createSignal("");
  const [sending, setSending] = createSignal(false);
  let latest = 0;
  let alive = true;
  let field: HTMLTextAreaElement | undefined;

  // Only the newest fetch may write or mark, so overlapping answers neither reorder the thread nor mark twice.
  const refresh = async () => {
    const mine = ++latest;
    const id = props.id;

    const message = await failureOf(async () => {
      const comments = await app.rpc("todo.comments", { id });

      if (!alive || mine !== latest || id !== props.id) return;
      setThread(comments);

      if (comments.some((comment) => !comment.read)) await app.rpc("todo.markCommentsRead", { id });
    });

    if (alive && mine === latest && id === props.id) setFailure(message);
  };

  createEffect(on(() => props.id, () => { setThread([]); setFailure(null); void refresh(); }));
  onCleanup(events.subscribe((event) => { if (event.name === "todo.commented" && event.data.id === props.id) void refresh(); }));
  onCleanup(() => { alive = false; latest++; });

  const author = (comment: Comment) => comment.author.kind === "agent" ? rail.nodes.find((node) => node.id === comment.author.id)?.name ?? comment.author.id : copy.me;

  const send = async () => {
    const body = text();

    if (body.trim() === "" || sending()) return;
    setSending(true);
    const message = await failureOf(async () => { await app.rpc("todo.comment", { id: props.id, body }); });
    setSending(false);
    setSendFailure(message);

    // A rejected call keeps the typed text; the thread catches up through `todo.commented`.
    if (message === null) { setText(""); await refresh(); }
  };

  return <section class="todo-comments" aria-label={copy.commentsHeading(thread().length)}>
    <h3>{copy.commentsHeading(thread().length)}</h3>
    <Show when={failure()}>{(message) => <div><ErrorLine message={message()} /><button data-button="quiet" class="word" type="button" onClick={() => void refresh()}>{copy.commentRetry}</button></div>}</Show>
    <For each={thread()}>{(comment) => <div class="todo-comment" data-comment={comment.id}>
      <p class="todo-comment-head light"><span>{author(comment)}</span> <time datetime={new Date(comment.created_at).toISOString()}>{copy.commentTime(comment.created_at)}</time>
        <Show when={comment.author.kind === "agent"}> <button data-button="quiet" class="word" type="button" onClick={() => field?.focus()}>{copy.reply}</button></Show></p>
      <p class="todo-comment-body">{comment.body}</p>
    </div>}</For>
    <textarea class="todo-comment-field" rows={2} aria-label={copy.commentField} placeholder={copy.commentPlaceholder} value={text()}
      ref={(element) => { field = element; }}
      onInput={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); void send(); } }} />
    <Show when={sendFailure()}>{(message) => <ErrorLine message={message()} />}</Show>
    <p><button data-button="quiet" class="word" type="button" disabled={text().trim() === "" || sending()} onClick={() => void send()}>{copy.comment}</button></p>
  </section>;
};

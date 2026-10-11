import { createSignal, Show } from "solid-js";
import type { Kind } from "@contracts/Kind";
import { useConnectedProject } from "../state/connectedProject";

export type ReplyLine = { id: number; to: string; kind: Kind; question: boolean; answered: boolean; body: string };

/** U376: a Subagent's newest Message to its Door as one line under its now line; an unanswered question shows whole, with the field that answers it. */
export const Reply = (props: { reply: ReplyLine }) => {
  const { app } = useConnectedProject();
  const [text, setText] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const asking = () => props.reply.question && !props.reply.answered;

  const send = async () => {
    const body = text().trim();

    if (body === "" || pending()) return;

    setPending(true);

    try {
      await app.rpc("message.send", { to: props.reply.to, kind: "note", body, replyTo: props.reply.id });
      setText("");
      setFailure(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      setFailure(error.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="thread-reply" data-reply={props.reply.id} data-kind={props.reply.kind} data-full={asking() ? "" : undefined}>
      <p class="thread-reply-text" title={props.reply.body}>
        <span class="thread-reply-state">{props.reply.kind}</span> {asking() ? props.reply.body : props.reply.body.split("\n", 1)[0]}
        <Show when={props.reply.question && props.reply.answered}>
          {" "}
          <span class="thread-status" data-reply-answered>
            answered
          </span>
        </Show>
      </p>
      <Show when={asking()}>
        <textarea
          class="thread-reply-field"
          rows={1}
          aria-label="answer"
          value={text()}
          disabled={pending()}
          onInput={(typed) => setText(typed.currentTarget.value)}
        />
        <button data-button="quiet" type="button" class="word thread-card-answer" disabled={pending() || text().trim() === ""} onClick={() => void send()}>
          {failure() === null ? "answer" : "retry"}
        </button>
        <Show when={failure()}>
          {(message) => (
            <p class="ink thread-failure-text" data-tone="red" role="alert" title={message()}>
              {message()}
            </p>
          )}
        </Show>
      </Show>
    </div>
  );
};

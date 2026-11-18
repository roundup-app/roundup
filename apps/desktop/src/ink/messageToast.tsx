import { Show, createContext, createEffect, createMemo, createUniqueId, mapArray, untrack, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorLine } from "./ErrorLine";
import { RecoveryButtons, type Dismissible } from "./recovery";

/** U7310d: a message card has no time; `closed` answers the user closing the card. */
export type MessageCard = { id: string; body: () => JSX.Element; closed: () => void };

/** U7310d: what a view needs of the App's Toast queue: it shows a card, and the returned call takes the card down. */
export type MessageQueue = { message(card: MessageCard): () => void; /** U7471a: text a view's failure starts with when the card shows; empty when the view's Project is shown. */ origin?: () => string };

/** U7471a: the queue a Project's views reach: a failure raised while the Project is not shown starts with its name and ` · `. */
export const projectMessageQueue = (queue: MessageQueue, name: string, shown: () => boolean): MessageQueue => ({ message: card => queue.message(card), origin: () => (shown() ? "" : `${name} · `) });

/** The App's Toast queue, as the views under it reach it. */
export const ToastQueueContext = createContext<MessageQueue | null>(null);

/** A failure line: its message, Dismiss, recover action and extra controls. A status or notice is no toast (U7310d). */
type FailureLine = Dismissible & { message: string | null | false | undefined; content?: JSX.Element; action?: JSX.Element; class?: string };

/** U7314h: a card's body: the whole message as its title, the line's text and its Retry and Dismiss. */
export const MessageBody = (props: FailureLine) => (
  // The card is the only place a message wraps whole; its title holds the lines the text cuts.
  // oxlint-disable-next-line anti-slop/no-tooltip-bypass
  <div class="message-body" title={props.message || undefined}>
    <Show when={props.message}>{message => <ErrorLine message={message()} content={props.content} />}</Show>
    <div class="message-actions">{props.action}<RecoveryButtons recover={props.recover} dismiss={props.dismiss} dismissIn={props.dismissIn} /></div>
  </div>
);

/**
 * U7310d: a failure a view shows beside its content shows as one card in the App's Toast region, with the line's own text, Dismiss and recover action, and holds no place in the view.
 * A failure stays until the user dismisses it or its cause clears; a status or notice stays in its view. A new message is a new card, and closing the card runs the line's `dismiss`.
 * Pass the line's changing parts as getters, as a component's props are.
 */
export const createMessageToast = (line: FailureLine, queue: MessageQueue | null = useContext(ToastQueueContext)): void => {
  if (!queue) throw new Error("no toast region: a view showed a message outside the App's Toast queue");

  const id = createUniqueId();
  // The line is made under the view's owner, so it ends with the view; the card only shows it.

  const text = createMemo(() => line.message || null);

  // The origin is read once per message, so a card showing keeps its text when the user switches Project.
  const full = createMemo(() => {
    const message = text();

    return message ? `${untrack(() => queue.origin?.()) ?? ""}${message}` : null;
  });

  const body = <MessageBody {...line} message={full()} />;

  createEffect(text, shown => {
    if (!shown) return undefined;

    const card: MessageCard = { id, body: () => body, closed: () => line.dismiss() };

    return queue.message(card);
  });
};

/** A toast per failure in a list, each living as long as its failure is in the list. Pass the queue where the caller sits above the App's Toast context. */
export const createMessageToasts = <T,>(failures: () => readonly T[], line: (failure: T) => FailureLine, queue: MessageQueue | null = useContext(ToastQueueContext)): void => {
  // The memo only keeps the mapping read, so each failure's toast lives and goes with it.
  const _toasts = createMemo(mapArray(failures, failure => createMessageToast(line(failure), queue)));
};

import { createContext, createEffect, createMemo, createUniqueId, mapArray, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ReservedLine, type Dismissible } from "./ReservedLine";

/** U7310d: a message card has no time; `closed` answers the user closing the card. */
export type MessageCard = { id: string; body: () => JSX.Element; closed: () => void };

/** U7310d: what a view needs of the App's Toast queue: it shows a card, and the returned call takes the card down. */
export type MessageQueue = { message(card: MessageCard): () => void };

/** The App's Toast queue, as the views under it reach it. */
export const ToastQueueContext = createContext<MessageQueue | null>(null);

/** A failure line: its message, Dismiss, recover action and extra controls. A status or notice is no toast (U7310d). */
type FailureLine = Dismissible & { message: string | null | false | undefined; content?: JSX.Element; action?: JSX.Element };

/**
 * U7310d: a failure a view shows beside its content shows as one card in the App's Toast region, with the line's own text, Dismiss and recover action, and holds no place in the view.
 * A failure stays until the user dismisses it or its cause clears; a status or notice stays in its view. A new message is a new card, and closing the card runs the line's `dismiss`.
 * Pass the line's changing parts as getters, as a component's props are.
 */
export const createMessageToast = (line: FailureLine): void => {
  const queue = useContext(ToastQueueContext);

  if (!queue) throw new Error("no toast region: a view showed a message outside the App's Toast queue");

  const id = createUniqueId();
  // The line is made under the view's owner, so it ends with the view; the card only shows it.
  const body = <ReservedLine {...line} />;
  const text = createMemo(() => line.message || null);

  createEffect(text, shown => {
    if (!shown) return undefined;

    const card: MessageCard = { id, body: () => body, closed: () => line.dismiss() };

    return queue.message(card);
  });
};

/** A toast per failure in a list, each living as long as its failure is in the list. */
export const createMessageToasts = <T,>(failures: () => readonly T[], line: (failure: T) => FailureLine): void => {
  createMemo(mapArray(failures, failure => createMessageToast(line(failure()))));
};

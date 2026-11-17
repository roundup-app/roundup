import { createEffect, createMemo, createUniqueId } from "solid-js";
import type { ComponentProps } from "solid-js";
import { ReservedLine, type Dismissible } from "../ink/ReservedLine";
import { useToastQueue, type MessageCard } from "./queue";

/** The props of a `ReservedLine`: a failure with its Dismiss and recover action, or a status. */
type MessageLine = ComponentProps<typeof ReservedLine>;

/**
 * U7310d: a message a view shows beside its content shows as one card in the App's Toast region, with the line's own text, Dismiss and recover action, and holds no place in the view.
 * A failure stays until the user dismisses it; a status leaves when it clears. A new message is a new card, and closing the card runs the line's `dismiss`.
 * Pass the line's changing parts as getters, as a component's props are.
 */
export const createMessageToast = (line: MessageLine): void => {
  const queue = useToastQueue();
  const id = createUniqueId();
  // The line is made under the view's owner, so it ends with the view; the card only shows it.
  const body = <ReservedLine {...line} />;
  const text = createMemo(() => line.message || line.status || null);

  createEffect(text, shown => {
    if (!shown) return undefined;

    // SAFETY: `dismiss` is the one prop a status line lacks and a failure line may carry; both forms are read through it.
    const card: MessageCard = { id, body: () => body, closed: () => (line as Partial<Dismissible>).dismiss?.() };

    return queue.message(card);
  });
};

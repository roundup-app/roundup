import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { createToastQueue, ToastQueueContext } from "../toasts/queue";
import { Toasts } from "../toasts/Toasts";

/** The App's Toast queue around a harness whose views show their messages as Toasts (U7310d). ui-sdk's region keeps an empty alert and an empty status for its announcements, which a role query counts as one more notice, so the region is mounted only while a card shows. */
export const ToastHost = (props: { children: JSX.Element }) => {
  const queue = createToastQueue(() => true, () => {});

  return (
    <ToastQueueContext value={queue}>
      {props.children}
      <Show when={queue.toast.store.toasts().length > 0}>
        <Toasts queue={queue} />
      </Show>
    </ToastQueueContext>
  );
};

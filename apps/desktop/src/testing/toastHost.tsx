import type { JSX } from "@solidjs/web";
import { createToastQueue } from "../toasts/queue";
import { ToastQueueContext } from "../ink/messageToast";
import { Toasts } from "../toasts/Toasts";

/** The App's Toast queue and region around a harness whose views show their messages as Toasts (U7310d). */
export const ToastHost = (props: { children: JSX.Element }) => {
  const queue = createToastQueue(() => true, () => {});

  return (
    <ToastQueueContext value={queue}>
      {props.children}
      <Toasts queue={queue} />
    </ToastQueueContext>
  );
};

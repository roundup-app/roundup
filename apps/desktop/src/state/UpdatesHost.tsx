import { untrack, type JSX } from "solid-js";
import type { App } from "../app/seam";
import type { ToastQueue } from "../toasts/queue";
import { watchUpdates } from "../toasts/updates";
import { createUpdates, UpdatesProvider } from "./updates";

/** U7208: the update facts for Settings below it, and a Toast for each new version they name. */
export const UpdatesHost = (props: {
  app: App;
  notify: ToastQueue["notify"];
  children: JSX.Element;
}) => {
  const updates = untrack(() => createUpdates(props.app));

  untrack(() => watchUpdates(updates, props.notify));

  return <UpdatesProvider value={updates}>{props.children}</UpdatesProvider>;
};

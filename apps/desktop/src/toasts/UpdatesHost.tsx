import { untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { App } from "../app/seam";
import { createUpdates, UpdatesProvider } from "../state/updates";
import type { ToastQueue } from "./queue";
import { watchUpdates } from "./updates";

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

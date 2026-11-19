import type { ComponentProps } from "@solidjs/web";
import { App } from "../App";
import { padReadStorage } from "../pads/padRead";

/** Existing connected observers explicitly inspect navigation; U2539b mounts App directly. */
export const RequestedApp = (props: ComponentProps<typeof App>) => {
  // U7499b: an empty read record, so the Project's Pads are unread and list above the folds; only a Project with no record counts them read.
  if (props.app.opened.project) padReadStorage(props.app.opened.project.path).write({});

  return <App initialShelfOpen {...props} prepareIdle={open => {
  open.showView("workstreams");
  open.showView("terminal-tabs");
  props.prepareIdle?.(open);
}} />
};

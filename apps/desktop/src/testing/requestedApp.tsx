import type { ComponentProps } from "solid-js";
import { App } from "../App";

/** Existing connected observers explicitly inspect navigation; U2539b mounts App directly. */
export const RequestedApp = (props: ComponentProps<typeof App>) => <App initialShelfOpen {...props} prepareIdle={open => {
  open.showView("workstreams");
  open.showView("terminal-tabs");
  props.prepareIdle?.(open);
}} />;

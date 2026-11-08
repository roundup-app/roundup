import type { ActivationSource } from "../keys/registry";
import type { DrawerState } from "../drawer/drawer";
import type { ConnectedProject } from "../state/connectedProject";
import type { ShelfFrame } from "./frame";
import { openSelectedRow } from "./openItem";

/** U3721a: the four sizes `⌘K B` steps through. */
export type BenchSize = "closed" | "list" | "item" | "full";

/** U3721a: closed → list → list with the open item → full → closed; the cycle skips full in overlay mode (U371) and the list steps straight to full with no selected row. */
export const createBenchRotation = (props: {
  frame: ShelfFrame;
  connection?: () => ConnectedProject | Error | undefined;
  toggle: (source: ActivationSource) => void;
}) => {
  const drawer = (): DrawerState | undefined => {
    const connected = props.connection?.();

    return connected && !(connected instanceof Error) ? connected.drawer : undefined;
  };

  const overlay = () => document.querySelector<HTMLElement>(".window")?.dataset["shelfMode"] === "overlay";

  const size = (): BenchSize => {
    const open = drawer();
    const fills = !overlay();

    if (open?.content()) return fills && open.size()?.maximised ? "full" : "item";

    if (!props.frame.open()) return "closed";

    return fills && props.frame.maximised() ? "full" : "list";
  };

  const close = () => {
    drawer()?.close("key");

    if (props.frame.maximised()) props.frame.toggleMaximise("key");

    if (props.frame.open()) props.toggle("key");
  };

  const step = (open: DrawerState | undefined) => {
    if (openSelectedRow()) {
      if (!overlay() && open?.size()?.maximised) open.size()?.toggle("key");
    } else if (overlay()) close();
    else props.frame.toggleMaximise("key");
  };

  const rotate = () => {
    const open = drawer();
    const current = size();

    if (props.frame.peeking() || current === "closed") props.toggle("key");
    else if (current === "full" || current === "item" && overlay()) close();
    else if (current === "item") open?.size()?.toggle("key");
    else step(open);
  };

  return { size, rotate };
};

import type { ActivationSource } from "../keys/registry";
import type { DrawerState } from "../drawer/drawer";
import type { ShelfFrame } from "./frame";
import { openSelectedRow } from "./openItem";

/** U3721a: the four sizes `⌘K B` steps through. */
export type BenchSize = "closed" | "list" | "item" | "full";

/** U3721a: closed → list → list with the open item → full → closed; the cycle skips full in overlay mode (U371) and the list steps straight to full with no selected row. */
export const createBenchRotation = (props: {
  frame: ShelfFrame;
  drawer: () => DrawerState | undefined;
  overlay: () => boolean;
  toggle: (source: ActivationSource) => void;
}) => {
  const size = (): BenchSize => {
    const drawer = props.drawer();
    const fills = !props.overlay();

    if (drawer?.content()) return fills && drawer.size()?.maximised ? "full" : "item";

    if (!props.frame.open()) return "closed";

    return fills && props.frame.maximised() ? "full" : "list";
  };

  const close = () => {
    props.drawer()?.close("key");

    if (props.frame.maximised()) props.frame.toggleMaximise("key");

    if (props.frame.open()) props.toggle("key");
  };

  const rotate = () => {
    const drawer = props.drawer();
    const current = size();

    if (props.frame.peeking()) props.toggle("key");
    else if (current === "closed") props.toggle("key");
    else if (current === "full" || current === "item" && props.overlay()) close();
    else if (current === "item") drawer?.size()?.toggle("key");
    else if (openSelectedRow()) {
      if (!props.overlay() && drawer?.size()?.maximised) drawer.size()?.toggle("key");
    } else if (props.overlay()) close();
    else props.frame.toggleMaximise("key");
  };

  return { size, rotate };
};

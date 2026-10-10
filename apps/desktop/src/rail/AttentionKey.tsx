import { onCleanup } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import { nextAttention } from "./attention";

/** `⌘J` selects the next Agent of the open Project that needs the user (U30); the strip's mark and `⇧⌘J` do the same across Projects (U181). No UI of its own. */
export const AttentionKey = () => {
  const { rail } = useConnectedProject();

  const onKey = (press: KeyboardEvent) => {
    if (!press.metaKey || press.ctrlKey || press.altKey || press.shiftKey) return;

    if (press.key.toLowerCase() !== "j") return;

    press.preventDefault();

    const next = nextAttention(rail.nodes, rail.selected());

    if (next) rail.select(next.id);
  };

  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));

  return null;
};

import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { nextAttention } from "./attention";

/** `⌘J` selects the next Agent of the open Project that needs the user (U30); the strip's mark and `⇧⌘J` do the same across Projects (U181). No UI of its own. */
export const AttentionKey = () => {
  const { rail } = useConnectedProject();

  registerKeys({ kind: "app" }, [{
    chords: ["Meta+j"],
    run: () => {
      const next = nextAttention(rail.nodes, rail.selected());

      if (next) rail.select(next.id);
    },
  }]);

  return null;
};

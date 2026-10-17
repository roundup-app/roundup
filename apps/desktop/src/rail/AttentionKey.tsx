import { useConnectedProject } from "../state/connectedProject";
import { leaderChord } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { nextAttention } from "./attention";

/** Leader `J` selects the next Agent of the open Project that needs the user (U30); the strip's mark and leader `⇧J` do the same across Projects (U181). No UI of its own. */
export const AttentionKey = () => {
  const { rail } = useConnectedProject();

  registerKeys({ kind: "leader" }, [{
    chords: leaderChord("J"),
    run: () => {
      const next = nextAttention(rail.nodes, rail.selected());

      if (next) rail.select(next.id);
    },
  }]);

  return null;
};

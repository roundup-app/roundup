import { useConnectedProject } from "../state/connectedProject";
import { CHORDS, LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { nextAttention } from "./attention";

/** Direct `⌃⌘J` and leader `J` select the next Agent of the open Project that needs the user (U30); the strip's mark and leader `⇧J` do the same across Projects (U181). No UI of its own. */
export const AttentionKey = () => {
  const { rail } = useConnectedProject();

  const capture = () => ({
    available: () => nextAttention(rail.nodes, rail.selected(), rail.dismissed) !== null,
    invoke: () => {
      const next = nextAttention(rail.nodes, rail.selected(), rail.dismissed);

      if (next) rail.select(next.id);
    },
  });

  registerKeys({ kind: "leader" }, [{ action: LEADER.find((row) => row.keys === "J")!, searchable: false, capture }]);
  registerKeys({ kind: "app" }, [{ action: CHORDS.find((row) => row.keys === "⌃⌘J")!, capture }]);

  return null;
};

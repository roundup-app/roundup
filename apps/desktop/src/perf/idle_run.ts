import type { ConnectedProject } from "../state/connectedProject";
import { invoke } from "@tauri-apps/api/core";
import { createXtermEmulators } from "../terminal/emulator";
import { createIdleEvidence } from "./idle";

/** No driver, spawning, typing or scheduling: the parent prepares the isolated Project and selection. */
export const createIdleRun = (evidence = createIdleEvidence(document, window, () => performance.now(), record => invoke("record_idle_evidence", { record }))) => {

  const createEmulator = createXtermEmulators({
    input() {}, encoded() {}, arrived() {}, written() {}, rendered() {},
    renderer: evidence.renderer,
  });

  Object.defineProperty(window, "__roundupIdleEvidence", { configurable: true, value: () => {
    const checkpoint = evidence.checkpoint();

    evidence.stop();

    return checkpoint;
  } });
  let selected = false;

  return {
    createEmulator,
    selected: evidence.selected,
    prepare(open: ConnectedProject) {
      const target = open.rail.nodes.find(node => node.kind === "agent" && node.terminal_id !== null);

      if (!selected && target) {
        selected = true;
        open.rail.select(target.id);
      }
    },
  };
};

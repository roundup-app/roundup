import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js";
import { isWorkstream } from "../rail/layout";
import type { ConnectedProject } from "../state/connectedProject";

export type ShelfScope = {
  /** The Rail id of the selected Workstream, else null (no row, an Agent or a Terminal). */
  workstream: () => string | null;
  /** U347: false until the user chooses `all`; the choice is held for the Workstream it was made on and nothing is stored. */
  showAll: () => boolean;
  setShowAll: (all: boolean) => void;
};

const scopes = new WeakMap<ConnectedProject, ShelfScope>();

/** U347: one scope per Project, so the `Todos` scope control governs the `pads` list too. */
export const useShelfScope = (connected: ConnectedProject): ShelfScope => {
  const held = scopes.get(connected);

  if (held) return held;

  const made = createRoot((): ShelfScope => {
    const [all, setAll] = createSignal(false);

    const workstream = createMemo(() => {
      const id = connected.rail.selected();

      return connected.rail.nodes.some((node) => node.id === id && isWorkstream(node)) ? id : null;
    });

    createEffect(on(workstream, () => setAll(false), { defer: true }));

    return { workstream, showAll: () => workstream() !== null && all(), setShowAll: setAll };
  });

  scopes.set(connected, made);

  return made;
};

import { makeEventListener } from "@solid-primitives/event-listener";
import { createMemo, createResource } from "solid-js";
import type { Reaction } from "@contracts/reaction/Reaction";
import { useConnectedProject } from "../state/connectedProject";

/** NR9: saved reactions remain readable when their Agents no longer exist. */
export const createReactions = () => {
  const { app, drafts, daemonExit } = useConnectedProject();

  // Project-owned submissions outlive the overview; settlement refreshes its current mount.
  const submissions = createMemo(() => daemonExit() === null ? JSON.stringify(drafts.list()
    .filter(draft => draft.destination.surface === "reactions" && (draft.status === "pending" || draft.status === "unknown"))
    .map(draft => draft.revision)) : false);

  const [read, { refetch, mutate }] = createResource(submissions, async (_key, { value }): Promise<{ list: Reaction[]; failure: string | null }> => {
    try {
      return { list: await app.rpc("reaction.list", null), failure: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { list: value?.list ?? [], failure: error.message };
    }
  }, { initialValue: { list: [], failure: null } });

  const refresh = () => { if (daemonExit() === null) void refetch(); };

  makeEventListener(window, "focus", refresh);

  return { read, refresh, refetch, dismiss: () => mutate(value => ({ ...value, failure: null })) };
};


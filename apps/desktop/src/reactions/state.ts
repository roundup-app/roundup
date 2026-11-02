import { createMemo, createResource, onCleanup } from "solid-js";
import type { Reaction } from "@contracts/reaction/Reaction";
import { useConnectedProject } from "../state/connectedProject";

/** NR9: saved reactions remain readable when their Agents no longer exist. */
export const createReactions = () => {
  const { app, drafts, daemonExit, events } = useConnectedProject();

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

  onCleanup(events.subscribe(event => {
    if (event.name === "reaction.changed" || ((event.name === "message.delivered" || event.name === "message.dropped") && read().list.some(reaction => reaction.firings.some(firing => firing.message === event.data.id)))) refresh();
  }));

  return { read, refresh, refetch, accept: (reaction: Reaction) => mutate(value => ({ ...value, list: value.list.map(saved => saved.id === reaction.id ? reaction : saved) })), dismiss: () => mutate(value => ({ ...value, failure: null })) };
};


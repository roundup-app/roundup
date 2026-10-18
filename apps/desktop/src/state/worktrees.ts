import { createEffect, createResource, createRoot, createSignal, onCleanup, untrack } from "solid-js";
import type { Accessor, Resource } from "solid-js";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import type { AppSeam, DaemonExit } from "../app/seam";
import { failureOf } from "../todos/failureOf";
import type { RailState } from "./rail";

type Read = { failure: null; state: WorktreeState } | { failure: string };

type Entry = { identity: string; read: Resource<Read>; refresh: () => Promise<void>; dispose: () => void; attempted: number };

/** One visible Project owner; neither consumer can retain an entry across a recorded identity change. */
export const createWorktreeState = (app: AppSeam, rail: RailState, now: Accessor<number>, daemonExit: Accessor<DaemonExit | null>) => {
  const entries = new Map<string, Entry>();
  const [revision, changed] = createSignal(0);

  const identity = (id: string) => {
    const node = rail.nodes.find((node) => node.id === id);

    return node?.worktree ? JSON.stringify([id, node.worktree.path, node.worktree.branch, node.worktree.base]) : null;
  };

  const current = (id: string) => {
    revision();
    const entry = entries.get(id);

    return !daemonExit() && entry?.identity === identity(id) ? entry : undefined;
  };

  const clear = () => {
    for (const entry of entries.values()) entry.dispose();
    entries.clear();
    changed((value) => value + 1);
  };

  return {
    read: (id: string): Read | undefined => current(id)?.read(),
    refresh: (id: string): Promise<void> => current(id)?.refresh() ?? Promise.resolve(),
    /** Called once by the connected Project's rendered owner. Uses the App's coarse tick, never a second timer. */
    watch: (visible: Accessor<boolean>) => {
      createEffect(() => {
        const active = visible() && !daemonExit();
        const time = now();

        const identities = active ? rail.nodes.flatMap((node) => {
          const key = identity(node.id);

          return key === null ? [] : [{ id: node.id, key }];
        }) : [];

        untrack(() => {
          for (const [id, entry] of entries) {
            if (!identities.some((item) => item.id === id && item.key === entry.identity)) {
              entry.dispose();
              entries.delete(id);
            }
          }

          for (const { id, key } of identities) {
            let entry = entries.get(id);

            if (!entry) {
              entry = createRoot((dispose): Entry => {
                let latest: Promise<Read>;

                const [read, { refetch }] = createResource(() => latest = (async (): Promise<Read> => {
                  let state!: WorktreeState;
                  const failure = await failureOf(async () => { state = await app.rpc("agent.worktreeState", { id }); });

                  return failure === null ? { failure, state } : { failure };
                })());

                return { identity: key, read, dispose, attempted: time, refresh: async () => {
                  // The resource owns completion; callers also join its initial request.
                  if (read.loading) await latest;
                  else await refetch();
                } };
              });
              entries.set(id, entry);
            } else if (time - entry.attempted >= 5_000) {
              entry.attempted = time;
              void entry.refresh();
            }
          }

          changed((value) => value + 1);
        });
      });
      onCleanup(clear);
    },
  };
};

import { createEffect, createResource, createRoot, createSignal, onCleanup, untrack } from "solid-js";
import type { Accessor, Resource } from "solid-js";
import type { Worktree } from "@contracts/agent/Worktree";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import type { AppSeam, DaemonExit } from "../app/seam";
import { copy } from "./copy";
import { failureOf } from "../app/failureOf";
import type { RailState } from "./rail";
import { NOW_TICK_MS } from "./clock";

type Read = { failure: null; state: WorktreeState } | { failure: string };

type Entry = { identity: Worktree; read: Resource<Read>; refresh: () => Promise<Read>; dispose: () => void; attempted: number };

/** One visible Project owner; neither consumer can retain an entry across a recorded identity change. */
export const createWorktreeState = (app: AppSeam, rail: RailState, now: Accessor<number>, daemonExit: Accessor<DaemonExit | null>) => {
  const entries = new Map<string, Entry>();
  const [revision, changed] = createSignal(0);

  const current = (id: string) => {
    revision();

    return !daemonExit() ? entries.get(id) : undefined;
  };

  const clear = () => {
    for (const entry of entries.values()) entry.dispose();
    entries.clear();
    changed((value) => value + 1);
  };

  return {
    read: (id: string): Read | undefined => current(id)?.read(),
    refresh: (id: string): Promise<Read> => {
      const entry = current(id);

      if (!entry) return Promise.resolve({ failure: copy.worktreeReadUnavailable });

      // A view can open just before a coarse tick; skip that tick rather than poll twice within five seconds.
      if (!entry.read.loading) entry.attempted = now() + NOW_TICK_MS;

      return entry.refresh();
    },
    /** Called once by the connected Project's rendered owner. Uses the App's coarse tick, never a second timer. */
    watch: (visible: Accessor<boolean>) => {
      // U5643c: Rail ownership changes independently of the coarse polling clock.
      // Only these fields are tracked; name/Status changes leave resources alone.
      createEffect(() => {
        const identities = visible() && !daemonExit() ? rail.nodes.flatMap(node => {
          const worktree = node.worktree;

          return worktree ? [{ id: node.id, path: worktree.path, branch: worktree.branch, base: worktree.base }] : [];
        }) : [];

        untrack(() => {
          const live = new Set<string>();
          let replaced = false;

          for (const { id, path, branch, base } of identities) {
            live.add(id);
            const existing = entries.get(id);

            if (existing && existing.identity.path === path && existing.identity.branch === branch && existing.identity.base === base) continue;
            existing?.dispose();

            const entry = createRoot((dispose): Entry => {
              let latest: Promise<Read>;

              const [read, { refetch }] = createResource(() => latest = (async (): Promise<Read> => {
                let state!: WorktreeState;
                const failure = await failureOf(async () => { state = await app.rpc("agent.worktreeState", { id }); });

                return failure === null ? { failure, state } : { failure };
              })());

              return { identity: { path, branch, base }, read, dispose, attempted: now() + NOW_TICK_MS, refresh: () => {
                // Keep the request outcome available to its caller even after resource disposal.
                if (!read.loading) void refetch();

                return latest;
              } };
            });

            entries.set(id, entry);
            replaced = true;
          }

          for (const [id, entry] of entries) {
            if (live.has(id)) continue;
            entry.dispose();
            entries.delete(id);
            replaced = true;
          }

          if (replaced) changed(value => value + 1);
        });
      });
      createEffect(() => {
        const time = now();

        untrack(() => {
          for (const entry of entries.values()) {
            if (time - entry.attempted < 5_000) continue;
            entry.attempted = time;
            void entry.refresh();
          }
        });
      });
      onCleanup(clear);
    },
  };
};

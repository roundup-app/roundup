import { isDoor } from "./doorNode";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type { Worktree } from "@contracts/agent/Worktree";
import type { WorktreeState } from "@contracts/agent/WorktreeState";
import type { AppSeam, DaemonExit } from "../app/seam";
import { copy } from "./copy";
import { failureOf } from "../app/failureOf";
import type { RailState } from "./rail";
import { NOW_TICK_MS } from "./clock";

type Read = { failure: null; state: WorktreeState } | { failure: string };

type Entry = { identity: Worktree; read: Accessor<Read | undefined>; loading: () => boolean; refresh: () => Promise<Read>; attempted: number };

/** One visible Project owner; neither consumer can retain an entry across a recorded identity change. */
export const createWorktreeState = (app: AppSeam, rail: RailState, now: Accessor<number>, daemonExit: Accessor<DaemonExit | null>) => {
  const entries = new Map<string, Entry>();
  const [revision, changed] = createSignal(0);

  const current = (id: string) => {
    revision();

    return !daemonExit() ? entries.get(id) : undefined;
  };

  const openEntry = (id: string, identity: Worktree): Entry => {
    const [read, setRead] = createSignal<Read>();
    let latest!: Promise<Read>;
    let loading = false;

    const load = () => {
      loading = true;

      const request = latest = (async (): Promise<Read> => {
        let state!: WorktreeState;
        const failure = await failureOf(async () => { state = await app.rpc("agent.worktreeState", { id }); });

        return failure === null ? { failure, state } : { failure };
      })();

      void request.then(result => {
        loading = false;
        setRead(result);
      });
    };

    load();

    return { identity, read, loading: () => loading, attempted: untrack(now) + NOW_TICK_MS, refresh: () => {
      // Keep the request outcome available to its caller even after the entry is dropped.
      if (!loading) load();

      return latest;
    } };
  };

  const clear = () => {
    entries.clear();
    changed((value) => value + 1);
  };

  return {
    read: (id: string): Read | undefined => current(id)?.read(),
    /** U7371b: the Worktree is in main and holds nothing else; no Worktree or no collected state is never finished. */
    finished: (id: string): boolean => {
      const read = current(id)?.read();

      return read?.failure === null && read.state.integrated === true && !read.state.dirty && read.state.ahead === 0;
    },
    refresh: (id: string): Promise<Read> => {
      const entry = current(id);

      if (!entry) return Promise.resolve({ failure: copy.worktreeReadUnavailable });

      // A view can open just before a coarse tick; skip that tick rather than poll twice within five seconds.
      if (!entry.loading()) entry.attempted = untrack(now) + NOW_TICK_MS;

      return entry.refresh();
    },
    /** Called once by the connected Project's rendered owner. Uses the App's coarse tick, never a second timer. */
    watch: (visible: Accessor<boolean>) => {
      // U5643c: Rail ownership changes independently of the coarse polling clock.
      // Only these fields are tracked; name/Status changes leave resources alone.
      createEffect(() => visible() && !daemonExit() ? rail.nodes.flatMap(node => {
        const worktree = isDoor(node) ? node.worktree : null;

        return worktree ? [{ id: node.id, path: worktree.path, branch: worktree.branch, base: worktree.base }] : [];
      }) : [], identities => {
        const live = new Set<string>();
        let replaced = false;

        for (const { id, path, branch, base } of identities) {
          live.add(id);
          const existing = entries.get(id);

          if (existing && existing.identity.path === path && existing.identity.branch === branch && existing.identity.base === base) continue;
          entries.set(id, openEntry(id, { path, branch, base }));
          replaced = true;
        }

        for (const id of entries.keys()) {
          if (live.has(id)) continue;
          entries.delete(id);
          replaced = true;
        }

        if (replaced) changed(value => value + 1);
      });
      createEffect(now, time => {
        for (const entry of entries.values()) {
          if (time - entry.attempted < 5_000) continue;
          entry.attempted = time;
          void entry.refresh();
        }
      });
      onCleanup(clear);
    },
  };
};

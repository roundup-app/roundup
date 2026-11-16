import { createEffect, untrack, createStore } from "solid-js";
import { isWorkstreamChild } from "../state/railTopology";
import { retryRead } from "../app/seam";
import { copy as appCopy } from "./copy";
import type { OutputMessage, OutputSubscription } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";
import { isDoor } from "../state/doorNode";

/** One Terminal's output subscription that exists only to learn that bytes came: the first one ends it. */
type Watch = { open: boolean; subscription: OutputSubscription | null };

export type Watches = {
  /** U6249b: subscribing is a read, so it retries like one; a subscription nobody wants any more ends the retries (`null`). */
  subscribe(id: string, listener: (message: OutputMessage) => void, wanted: () => boolean): Promise<OutputSubscription | null>;
  stop(id: string): Promise<void>;
  watching(id: string): boolean;
  markUnseen(id: string, on: boolean): void;
  unseen(id: string): boolean;
  setBubbled(id: string, on: boolean): void;
  bubbled(id: string): boolean;
  reconcile(): void;
  stopAll(): void;
};

type Deps = {
  connected: ConnectedProject;
  exited: (id: string) => boolean;
  streaming: (id: string) => boolean;
  /** The offset up to which a Terminal's output was shown, kept when its stream is released. */
  shownTo: ReadonlyMap<string, number>;
  disposed: () => boolean;
};

/** U6119c: a plain Terminal no one is streaming is watched until output arrives, and then it is unseen. */
export const createWatches = ({ connected, exited, streaming, shownTo, disposed }: Deps): Watches => {
  const { app, rail } = connected;
  const watches = new Map<string, Watch>();
  const [bubbled, setBubbled] = createStore<Record<string, true | undefined>>({});
  const [unseenIds, setUnseen] = createStore<Record<string, true | undefined>>({});

  const markUnseen = (id: string, on: boolean): void => {
    // U6119c: a Workstream child's Terminals, its own and those it owns, draw no unseen output.
    const owner = rail.terminals().find((terminal) => terminal.id === id)?.owner;

    if (on && rail.nodes.some((node) => ((isDoor(node) && node.terminal_id === id) || node.id === owner) && isWorkstreamChild(rail.nodes, node))) return;

    if (!!untrack(() => unseenIds[id]) !== on) setUnseen(draft => { if (on) draft[id] = true; else delete draft[id]; });
  };

  const stop = async (id: string): Promise<void> => {
    const watch = watches.get(id);

    if (!watch) return;

    watch.open = false;
    watches.delete(id);

    try {
      await watch.subscription?.release();
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (!disposed()) console.warn(appCopy.terminalOutputNotWatched(thrown.message));
    }
  };

  /** The first try is made at once and counts as the read's first attempt, so a subscription that works is placed with no extra wait. */
  const subscribe: Watches["subscribe"] = (id, listener, wanted) => {
    if (!wanted()) return Promise.resolve(null);

    let first: Promise<OutputSubscription> | null = app.selectOutput(id, listener);

    return first.catch(() => retryRead(async () => {
      const attempt = first ?? (wanted() ? app.selectOutput(id, listener) : null);

      first = null;

      return attempt;
    }));
  };

  /** Bytes the watch missed between the stream's release and its own start (`offset` past `shownTo`) count as unseen too. */
  const start = (id: string): void => {
    const watch: Watch = { open: true, subscription: null };
    const seen = shownTo.get(id);

    watches.set(id, watch);

    void (async () => {
      try {
        const subscription = await subscribe(id, () => {
          if (!watch.open) return;

          markUnseen(id, true);
          void stop(id);
        }, () => watch.open);

        if (!watch.open || subscription === null) {
          await subscription?.release();

          return;
        }

        watch.subscription = subscription;

        if (seen !== undefined && subscription.offset > seen) {
          markUnseen(id, true);
          await stop(id);
        }
      } catch (thrown) {
        if (!(thrown instanceof Error)) throw thrown;

        // The watch only learns that bytes came: nothing here is the user's to act on.
        if (watch.open) console.warn(appCopy.terminalOutputNotWatched(thrown.message));
      }
    })();
  };

  /** A plain Terminal no one is streaming gets a watch until it is unseen; a Door's or Agent's Terminal, an exited one and one already unseen get none. */
  const plan = () => {
    const panes = new Set(rail.nodes.flatMap((node) => isDoor(node) && node.terminal_id !== null ? [node.terminal_id] : []));
    const wanted = new Set(rail.terminals().filter((terminal) => !panes.has(terminal.id)).map((terminal) => terminal.id));

    return {
      stops: [...watches.keys()].filter((id) => !wanted.has(id) || exited(id)),
      starts: [...wanted].filter((id) => !streaming(id) && !watches.has(id) && !unseenIds[id] && !exited(id)),
      cleared: Object.keys(unseenIds).filter((id) => !wanted.has(id)),
    };
  };

  const reconcileTo = ({ stops, starts, cleared }: ReturnType<typeof plan>): void => {
    for (const id of stops) void stop(id);

    for (const id of starts) start(id);

    if (cleared.length) setUnseen(draft => { for (const id of cleared) delete draft[id]; });
  };

  const reconcile = (): void => reconcileTo(plan());

  createEffect(plan, reconcileTo);

  return {
    subscribe,
    stop,
    watching: (id) => watches.has(id),
    markUnseen,
    unseen: (id) => !!unseenIds[id],
    setBubbled: (id, on) => {
      if (!!bubbled[id] !== on) setBubbled(draft => { if (on) draft[id] = true; else delete draft[id]; });
    },
    bubbled: (id) => !!bubbled[id],
    reconcile,
    stopAll: () => {
      for (const id of watches.keys()) void stop(id);
    },
  };
};

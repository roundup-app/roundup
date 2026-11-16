import { createEffect, createMemo, createRoot, createSignal, createStore, onCleanup, reconcile, refresh, runWithOwner, untrack, type Accessor } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import { useConnectedProject } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";

/** The Project's Pads as `pad.list` last answered them. */
export type PadList = {
  pads: Accessor<readonly Pad[]>;
  /** True once the newest `pad.list` has answered, so U38's empty line never flashes before it. */
  loaded: Accessor<boolean>;
  /** The message of the newest `pad.list` if it failed, until a later one succeeds. */
  failure: Accessor<string | null>;
  reload: () => Promise<void>;
  /** Joins the current read without issuing another RPC. */
  settled: () => Promise<void>;
};

type Shared = { list: PadList; users: number; dispose: () => void };

const shared = new WeakMap<ConnectedProject, Shared>();

const open = (connected: ConnectedProject): Shared =>
  // The readers' count, not the first reader's owner, ends the list.
  runWithOwner(null, () => createRoot((dispose) => {
    // Each reply is reconciled by `incarnation`, so a read that changes one row leaves every other row untouched.
    const [shelf, setShelf] = createStore<Pad[]>([]);

    // A reconcile keeps the array, so the signal, not the store, tells an observer of the whole list that a reply landed.
    const [rows, setRows] = createSignal<Pad[] | undefined>(undefined, { equals: false });
    const [failure, setFailure] = createSignal<string | null>(null);
    let reading = true;
    const waiting: (() => void)[] = [];

    // A superseded read never answers, so `reading` ends only when the newest read has.
    const answered = () => {
      reading = false;

      for (const resolve of waiting.splice(0)) resolve();
    };

    // Equal replies still answer: a handler may return the same array twice.
    const answer = createMemo(async () => connected.app.rpc("pad.list", null), { equals: false });

    createEffect(answer, {
      effect: (reply) => {
        setShelf((draft) => { reconcile(reply, "incarnation")(draft); });
        setRows(shelf);
        setFailure(null);
        answered();
      },
      error: (thrown) => {
        if (!(thrown instanceof Error)) throw thrown;

        setFailure(thrown.message);
        answered();
      },
    });

    const settled = () => reading ? new Promise<void>((resolve) => { waiting.push(resolve); }) : Promise.resolve();

    // The write of an event handler lands before the read it asks for; a burst waits one microtask and shares one read.
    const reload = async () => {
      await Promise.resolve();
      reading = true;
      refresh(answer);
      await settled();
    };

    // An Event arrives outside every owner, so `reload` runs untracked.
    onCleanup(
      connected.events.subscribe((event) => {
        if (event.name === "pad.deleted") {
          setShelf((draft) => { reconcile(draft.filter((pad) => pad.name !== event.data.name), "incarnation")(draft); });
          setRows(shelf);
          void untrack(reload);
        } else if (event.name === "pad.changed") void untrack(reload);
      }),
    );

    return { list: { pads: () => rows() ?? [], loaded: () => rows() !== undefined, failure, reload, settled }, users: 0, dispose };
  }));

/** One `pad.list`, refetched on every `pad.changed` or `pad.deleted`, serves the Shelf and every Rail row (U58, U18); it logs no Touch. The fetch and the subscription end with the last reader. */
export const usePadList = (): PadList => {
  const connected = useConnectedProject();
  const entry = shared.get(connected) ?? open(connected);

  shared.set(connected, entry);
  entry.users += 1;

  onCleanup(() => {
    entry.users -= 1;

    if (entry.users > 0) return;

    shared.delete(connected);
    entry.dispose();
  });

  return entry.list;
};

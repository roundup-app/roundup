import { createStore, reconcile } from "solid-js/store";
import { batch, createRoot, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import { useConnectedProject } from "../../state/connectedProject";
import type { ConnectedProject } from "../../state/connectedProject";

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

const open = (connected: ConnectedProject): Shared => {
  let newest = 0;

  return createRoot((dispose) => {
    const [state, setState] = createStore<{ pads: Pad[] }>({ pads: [] });
    const [refetched, setRefetched] = createSignal(0);

    // Reconciliation preserves rows; callers observing the whole list still need each accepted read.
    const pads = () => { refetched();

 return state.pads; };

    const [loaded, setLoaded] = createSignal(false);
    const [failure, setFailure] = createSignal<string | null>(null);

    let latest: Promise<void> = Promise.resolve();

    /** Only the newest request may set the list, its failure or `loaded`: a slower, older reply must not put stale Pads back, overwrite a later failure, or flash the empty line while a retry is in flight. */
    const refetch = async () => {
      newest += 1;

      const mine = newest;

      try {
        const listed = await connected.app.rpc("pad.list", null);

        if (mine !== newest) {
          await latest;

          return;
        }

        batch(() => {
          setState("pads", reconcile(listed, { key: "incarnation" }));
          setRefetched(count => count + 1);
        });
        setFailure(null);
        setLoaded(true);
      } catch (thrown) {
        if (!(thrown instanceof Error)) throw thrown;

        if (mine !== newest) {
          await latest;

          return;
        }

        setFailure(thrown.message);
      }

    };

    const reload = () => {
      latest = refetch();

      return latest;
    };

    onCleanup(
      connected.events.subscribe((event) => {
        if (event.name === "pad.deleted") {
          batch(() => { setState("pads", reconcile(pads().filter(pad => pad.name !== event.data.name), { key: "incarnation" })); setRefetched(count => count + 1); });
          void reload();
        } else if (event.name === "pad.changed") void reload();
      }),
    );

    void reload();

    return { list: { pads, loaded, failure, reload, settled: () => latest }, users: 0, dispose };
  });
};

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

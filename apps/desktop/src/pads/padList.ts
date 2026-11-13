import { createResource, createRoot, onCleanup } from "solid-js";
import { keyedStore } from "../app/keyedStore";
import type { Accessor } from "solid-js";
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
  createRoot((dispose) => {
    const { storage, rows } = keyedStore<Pad>("incarnation");
    let reading: Promise<unknown> = Promise.resolve();
    const [list, { refetch, mutate }] = createResource(() => (reading = connected.app.rpc("pad.list", null)), { storage });

    /** Joins the read in flight, a failed one included. */
    const settled = () => reading.then(() => undefined, () => undefined);

    const reload = async () => {
      await refetch();
      await settled();
    };

    onCleanup(
      connected.events.subscribe((event) => {
        if (event.name === "pad.deleted") {
          mutate((rows() ?? []).filter(pad => pad.name !== event.data.name));
          void reload();
        } else if (event.name === "pad.changed") void reload();
      }),
    );

    return { list: { pads: () => rows()?.slice() ?? [], loaded: () => rows() !== undefined, failure: () => list.error?.message ?? null, reload, settled }, users: 0, dispose };
  });

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

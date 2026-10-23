import type { Event as DaemonEvent } from "@contracts/Event";
import { RpcError, type AppSeam, type Unsubscribe } from "./seam";

const EVENTS_EXPIRED = -32009;

export type Events = {
  /**
   * Listeners hear every Event from the moment they subscribe, in the Daemon's order.
   * With `replay`, a listener also hears the saved Events from before the App connected (D11), once each, ahead of the live ones.
   */
  subscribe(listener: (event: DaemonEvent) => void, options?: { replay?: boolean }): Unsubscribe;
};

/**
 * Opens the single Daemon subscription, replaying the saved Events (`after: 0`, or from the oldest the log still keeps), and fans it out; resolves once the Daemon is sending, so a caller that fetches next misses nothing.
 * The Daemon answers its `head`: an Event numbered at or below it was saved before the subscription and is replay, which only a `replay` listener hears.
 */
export const connectEvents = async (app: AppSeam): Promise<Events> => {
  const listeners = new Map<(event: DaemonEvent) => void, boolean>();
  let head: number | null = null;
  // Events that arrive before the Daemon has answered, and replay no `replay` listener has taken yet.
  let held: DaemonEvent[] | null = [];

  const isReplay = (event: DaemonEvent) => head !== null && event.seq !== undefined && event.seq <= head;

  const deliver = (event: DaemonEvent) => {
    const replayed = isReplay(event);

    for (const [listener, replay] of listeners) if (replay || !replayed) listener(event);
  };

  const onEvent = (event: DaemonEvent) => {
    if (head === null || (held !== null && isReplay(event))) held?.push(event);
    else deliver(event);
  };

  try {
    head = await app.subscribe(onEvent, 0);
  } catch (error) {
    // The log keeps only its last Events: replay from the oldest one it names, so the older span stays unknown.
    const oldest = error instanceof RpcError && error.code === EVENTS_EXPIRED ? /oldest kept Event number is (\d+)/.exec(error.message)?.[1] : undefined;

    if (oldest === undefined) throw error;

    head = await app.subscribe(onEvent, Math.max(0, Number(oldest) - 1));
  }

  return {
    subscribe: (listener, options) => {
      listeners.set(listener, options?.replay === true);

      if (options?.replay === true && held !== null) {
        const pending = held;

        held = null;

        for (const event of pending) listener(event);
      }

      return () => listeners.delete(listener);
    },
  };
};

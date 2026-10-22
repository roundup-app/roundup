import type { Event as DaemonEvent } from "@contracts/Event";
import type { AppSeam, Unsubscribe } from "./seam";

export type Events = {
  /**
   * Listeners hear every Event from the moment they subscribe, in the Daemon's order.
   * With `replay`, a listener also hears the saved Events from before the App connected (D11), once each, ahead of the live ones.
   */
  subscribe(listener: (event: DaemonEvent) => void, options?: { replay?: boolean }): Unsubscribe;
};

/**
 * Opens the single Daemon subscription, replaying the saved Events (`after: 0`), and fans it out; resolves once the Daemon is sending, so a caller that fetches next misses nothing.
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

  head = await app.subscribe((event) => {
    if (head === null || (held !== null && isReplay(event))) held?.push(event);
    else deliver(event);
  }, 0);

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

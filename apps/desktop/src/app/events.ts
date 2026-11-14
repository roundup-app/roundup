import type { Event as DaemonEvent } from "@contracts/Event";
import type { AppSeam, Unsubscribe } from "./seam";

export type Events = {
  /**
   * Listeners hear every Event from the moment they subscribe, in the Daemon's order.
   * With `replay`, a listener also hears the saved Events from before the App connected (D11), once each, ahead of the live ones.
   */
  subscribe(listener: (event: DaemonEvent) => void, options?: { replay?: boolean }): Unsubscribe;
};

/** One handler per Event name, each typed by the Event of that name; a name with no row is ignored. */
export type EventHandlers = { [Name in DaemonEvent["name"]]?: (event: Extract<DaemonEvent, { name: Name }>) => void };

/** Runs the handler `handlers` holds for `event`'s name, if any. */
export const handleEvent = (handlers: EventHandlers, event: DaemonEvent): void => {
  // SAFETY: `handlers` is keyed by Event name, so the row under `event.name` takes this Event.
  (handlers[event.name] as ((event: DaemonEvent) => void) | undefined)?.(event);
};

/**
 * Opens the single Daemon subscription, replaying every Event the log still keeps (`kept: true`), and fans it out; resolves once the Daemon is sending, so a caller that fetches next misses nothing.
 * The Daemon answers its `head`: an Event numbered at or below it was saved before the subscription and is replay, which only a `replay` listener hears.
 */
export const connectEvents = async (app: AppSeam): Promise<Events> => {
  const listeners = new Map<(event: DaemonEvent) => void, boolean>();
  let head: number | null = null;
  // Every saved Event, kept so each `replay` listener hears all of them, whenever it subscribes (U504).
  const kept: DaemonEvent[] = [];
  let pending = true;

  const isReplay = (event: DaemonEvent) => head !== null && event.seq !== undefined && event.seq <= head;

  const deliver = (event: DaemonEvent) => {
    const replayed = isReplay(event);

    for (const [listener, replay] of listeners) if (replay || !replayed) listener(event);
  };

  const onEvent = (event: DaemonEvent) => {
    if (head === null) {
      kept.push(event);

      return;
    }

    if (isReplay(event)) kept.push(event);

    if (pending && isReplay(event)) return;

    deliver(event);
  };

  head = await app.subscribe(onEvent, { kept: true });

  return {
    subscribe: (listener, options) => {
      listeners.set(listener, options?.replay === true);

      if (options?.replay === true) {
        pending = false;

        for (const event of kept) listener(event);
      }

      return () => listeners.delete(listener);
    },
  };
};

import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Message } from "@contracts/message/Message";
import type { Events } from "../app/events";
import type { AppSeam, DaemonExit } from "../app/seam";

/** U3780: the Messages to one Agent that wait for it, read from `message.list` and the `message.*` Events, never from a second store. */
export type NoteQueue = {
  /** The pending Messages to `agent`, in id order (B7). */
  rows(agent: string): readonly Message[];
  /** Loads the Messages to `agent` once; the Events keep them. */
  load(agent: string): void;
  /** The cause of the last refused call about `agent`, or `null`. */
  failure(agent: string): string | null;
  remove(message: Message): Promise<void>;
};

export const createNoteQueue = (app: AppSeam, events: Events, daemonExit: Accessor<DaemonExit | null>): NoteQueue => {
  const [messages, setMessages] = createSignal<Map<number, Message>>(new Map());
  const [failures, setFailures] = createSignal<Map<string, string>>(new Map());
  const loaded = new Set<string>();

  const upsert = (message: Message): void => void setMessages((all) => new Map(all).set(message.id, message));

  const fail = (agent: string, cause: string | null): void => void setFailures((all) => {
    const next = new Map(all);

    if (cause === null) next.delete(agent);
    else next.set(agent, cause);

    return next;
  });

  events.subscribe((event) => {
    if (event.name === "message.sent" || event.name === "message.delivered" || event.name === "message.dropped") upsert(event.data);
  });

  const call = async (agent: string, run: () => Promise<Message>): Promise<void> => {
    if (daemonExit() !== null) return;

    try {
      await run();
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      fail(agent, error.message);
    }
  };

  return {
    rows: (agent) => [...messages().values()]
      .filter((message) => message.to === agent && message.status === "pending")
      .sort((a, b) => a.id - b.id),
    load: (agent) => {
      if (loaded.has(agent) || daemonExit() !== null) return;

      loaded.add(agent);
      void app.rpc("message.list", { to: agent, status: null }).then((all) => {
        // An Event that came while the list was on its way is newer than the list.
        setMessages((known) => {
          const next = new Map(known);

          for (const message of all) if (!next.has(message.id)) next.set(message.id, message);

          return next;
        });
      }).catch((error) => {
        loaded.delete(agent);

        if (!(error instanceof Error)) throw error;

        fail(agent, error.message);
      });
    },
    failure: (agent) => failures().get(agent) ?? null,
    remove: async (message) => {
      fail(message.to, null);
      await call(message.to, () => app.rpc("message.drop", { id: message.id }));
    },
  };
};

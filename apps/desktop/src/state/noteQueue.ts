import { batch, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Message } from "@contracts/message/Message";
import type { Events } from "../app/events";
import type { AppSeam, DaemonExit } from "../app/seam";

/** P3557c: one refused call. `message` is the Message id of a `message.drop` / `message.deliver`, or `null` for the Agent's `message.list`; `key` is its own identity, so equal text is not the same failure. */
export type NoteFailure = { key: number; agent: string; message: number | null; cause: string };

/** U3780: the Messages to one Agent that wait for it, read from `message.list` and the `message.*` Events, never from a second store. */
export type NoteQueue = {
  /** The waiting notes to `agent`, oldest first (B7). */
  rows(agent: string): readonly Message[];
  /** Loads the Messages to `agent` once; the Events keep them. */
  load(agent: string): void;
  /** The cause of the last refused call about `agent`, or `null`. */
  failure(agent: string): string | null;
  /** The failure `failure(agent)` shows, with its identity, or `null`. */
  selected(agent: string): NoteFailure | null;
  /** The user dismisses failure `key`: no Message, input or recipient changes, and a later failure is not hidden. */
  dismiss(key: number): void;
  remove(message: Message): Promise<void>;
};

/** B1: whether `message` waits in the queue: a note the user sent. */
const waiting = (message: Message): boolean => message.status === "pending" && message.from.kind === "user";

export const createNoteQueue = (app: AppSeam, events: Events, daemonExit: Accessor<DaemonExit | null>): NoteQueue => {
  const [messages, setMessages] = createSignal<Map<number, Message>>(new Map());
  const [failures, setFailures] = createSignal<readonly NoteFailure[]>([]);
  const loaded = new Set<string>();

  const upsert = (message: Message): void => void setMessages((all) => new Map(all).set(message.id, message));

  let counter = 0;

  /** Replaces the failure of the same Agent and Message (or list) with `cause`, or only clears it when `cause` is `null`. */
  const fail = (agent: string, message: number | null, cause: string | null): void => void setFailures((all) => {
    const next = all.filter((failure) => failure.agent !== agent || failure.message !== message);

    return cause === null ? next : [...next, { key: ++counter, agent, message, cause }];
  });

  const clearMessage = (id: number): void => void setFailures((all) => all.filter((failure) => failure.message !== id));

  events.subscribe((event) => {
    if (event.name === "message.sent" || event.name === "message.dropped") {
      batch(() => {
        if (event.name === "message.dropped") clearMessage(event.data.id);

        upsert(event.data);
      });
    } else if (event.name === "message.delivered") {
      batch(() => {
        clearMessage(event.data.id);
        upsert(event.data);
      });
    }
  });

  const call = async (message: Message, run: () => Promise<Message>): Promise<void> => {
    if (daemonExit() !== null) return;

    try {
      await run();
      fail(message.to, message.id, null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      fail(message.to, message.id, error.message);
    }
  };

  const selected = (agent: string): NoteFailure | null => failures().findLast((failure) => failure.agent === agent) ?? null;

  return {
    rows: (agent) => [...messages().values()]
      .filter((message) => message.to === agent && waiting(message))
      .sort((a, b) => a.id - b.id),
    load: (agent) => {
      if (loaded.has(agent) || daemonExit() !== null) return;

      loaded.add(agent);
      void app.rpc("message.list", { to: agent, status: null }).then((all) => {
        // An Event that came while the list was on its way is newer than the list.
        fail(agent, null, null);
        setMessages((known) => {
          const next = new Map(known);

          for (const message of all) if (!next.has(message.id)) next.set(message.id, message);

          return next;
        });
      }).catch((error) => {
        loaded.delete(agent);

        if (!(error instanceof Error)) throw error;

        fail(agent, null, error.message);
      });
    },
    failure: (agent) => selected(agent)?.cause ?? null,
    selected,
    dismiss: (key) => void setFailures((all) => all.filter((failure) => failure.key !== key)),
    remove: async (message) => {
      await call(message, () => app.rpc("message.drop", { id: message.id }));
    },
  };
};

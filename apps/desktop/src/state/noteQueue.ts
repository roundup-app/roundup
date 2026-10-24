import { batch, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Message } from "@contracts/message/Message";
import type { Events } from "../app/events";
import type { AppSeam, DaemonExit } from "../app/seam";

/** A note of the queue: `leaving` once the Agent took it while the user could see it, until its row has glided out (U3784). */
export type NoteRow = { message: Message; leaving: boolean };

/** P3557c: one refused call. `message` is the Message id of a `message.drop` / `message.deliver`, or `null` for the Agent's `message.list`; `key` is its own identity, so equal text is not the same failure. */
export type NoteFailure = { key: number; agent: string; message: number | null; cause: string };

/** U3780: the Messages to one Agent that wait for it, read from `message.list` and the `message.*` Events, never from a second store. */
export type NoteQueue = {
  /** The waiting notes to `agent`, oldest first (B7), then the ones still gliding out. */
  rows(agent: string): readonly NoteRow[];
  /** Loads the Messages to `agent` once; the Events keep them. */
  load(agent: string): void;
  /** The cause of the last refused call about `agent`, or `null`. */
  failure(agent: string): string | null;
  /** The failure `failure(agent)` shows, with its identity, or `null`. */
  selected(agent: string): NoteFailure | null;
  /** The user dismisses failure `key`: no Message, input or recipient changes, and a later failure is not hidden. */
  dismiss(key: number): void;
  /** The queue of `agent` is on screen until the returned call, so a taken note may glide. */
  watch(agent: string): () => void;
  remove(message: Message): Promise<void>;
  allow(message: Message): Promise<void>;
  /** The row of `id` finished leaving. */
  settle(id: number): void;
};

/** B1, B5: whether `message` waits in the queue: a note the user sent, or one a Route holds for the user. */
const waiting = (message: Message): boolean =>
  (message.status === "pending" && message.from.kind === "user")
  || (message.status === "held" && (message.from.kind === "user" || message.reason === "ask-first" || message.reason === "takeover"));

export const createNoteQueue = (app: AppSeam, events: Events, reducedMotion: Accessor<boolean>, daemonExit: Accessor<DaemonExit | null>): NoteQueue => {
  const [messages, setMessages] = createSignal<Map<number, Message>>(new Map());
  const [leaving, setLeaving] = createSignal<Set<number>>(new Set());
  const [failures, setFailures] = createSignal<readonly NoteFailure[]>([]);
  const loaded = new Set<string>();
  const watching = new Map<string, number>();

  const upsert = (message: Message): void => void setMessages((all) => new Map(all).set(message.id, message));

  let counter = 0;

  /** Replaces the failure of the same Agent and Message (or list) with `cause`, or only clears it when `cause` is `null`. */
  const fail = (agent: string, message: number | null, cause: string | null): void => void setFailures((all) => {
    const next = all.filter((failure) => failure.agent !== agent || failure.message !== message);

    return cause === null ? next : [...next, { key: ++counter, agent, message, cause }];
  });

  const clearMessage = (id: number): void => void setFailures((all) => all.filter((failure) => failure.message !== id));

  const forget = (id: number): void => void setLeaving((all) => {
    const next = new Set(all);

    next.delete(id);

    return next;
  });

  events.subscribe((event) => {
    if (event.name === "message.sent" || event.name === "message.held" || event.name === "message.dropped") {
      batch(() => {
        forget(event.data.id);

        if (event.name === "message.dropped") clearMessage(event.data.id);

        upsert(event.data);
      });
    } else if (event.name === "message.delivered") {
      const message = event.data;
      const shown = messages().get(message.id);
      const glides = shown !== undefined && waiting(shown) && (watching.get(message.to) ?? 0) > 0 && !document.hidden && !reducedMotion();

      batch(() => {
        if (glides) setLeaving((all) => new Set(all).add(message.id));

        clearMessage(message.id);

        upsert(message);
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
      .filter((message) => message.to === agent && (waiting(message) || leaving().has(message.id)))
      .sort((a, b) => a.id - b.id)
      .map((message) => ({ message, leaving: leaving().has(message.id) })),
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
    watch: (agent) => {
      watching.set(agent, (watching.get(agent) ?? 0) + 1);

      return () => watching.set(agent, (watching.get(agent) ?? 1) - 1);
    },
    remove: async (message) => {
      await call(message, () => app.rpc("message.drop", { id: message.id }));
    },
    allow: async (message) => {
      await call(message, () => app.rpc("message.deliver", { id: message.id }));
    },
    settle: forget,
  };
};

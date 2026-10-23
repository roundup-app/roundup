import { batch, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Kind } from "@contracts/Kind";
import type { Message } from "@contracts/message/Message";
import type { Events } from "../app/events";
import type { AppSeam, DaemonExit } from "../app/seam";

/** A note of the queue: `leaving` once the Agent took it while the user could see it, until its row has glided out (U3784). */
export type NoteRow = { message: Message; leaving: boolean };

/** U3780: the Messages to one Agent that wait for it, read from `message.list` and the `message.*` Events, never from a second store. */
export type NoteQueue = {
  /** The waiting notes to `agent`, oldest first (B7), then the ones still gliding out. */
  rows(agent: string): readonly NoteRow[];
  /** Loads the Messages to `agent` once; the Events keep them. */
  load(agent: string): void;
  draft(agent: string): string;
  setDraft(agent: string, text: string): void;
  /** The cause of the last refused call about `agent`, or `null`. */
  failure(agent: string): string | null;
  /** The queue of `agent` is on screen until the returned call, so a taken note may glide. */
  watch(agent: string): () => void;
  /** Enter queues the draft for the Agent's next step; `now` also interrupts it unless `kind` is idle at the send (U3781). */
  send(agent: string, now: boolean, kind: Kind | undefined): Promise<void>;
  remove(message: Message): Promise<void>;
  allow(message: Message): Promise<void>;
  /** The row of `id` finished leaving. */
  settle(id: number): void;
};

/** B1, B5: whether `message` waits in the queue: a note the user sent, or one a Route holds for the user. */
const waiting = (message: Message): boolean =>
  (message.status === "pending" && message.from.kind === "user")
  || (message.status === "held" && (message.from.kind === "user" || message.reason === "ask-first"));

export const createNoteQueue = (app: AppSeam, events: Events, reducedMotion: Accessor<boolean>, daemonExit: Accessor<DaemonExit | null>): NoteQueue => {
  const [messages, setMessages] = createSignal<Map<number, Message>>(new Map());
  const [leaving, setLeaving] = createSignal<Set<number>>(new Set());
  const [drafts, setDrafts] = createSignal<Map<string, string>>(new Map());
  const [failures, setFailures] = createSignal<Map<string, string>>(new Map());
  const loaded = new Set<string>();
  const sending = new Set<string>();
  const watching = new Map<string, number>();

  const upsert = (message: Message): void => void setMessages((all) => new Map(all).set(message.id, message));

  const fail = (agent: string, cause: string | null): void => void setFailures((all) => {
    const next = new Map(all);

    if (cause === null) next.delete(agent);
    else next.set(agent, cause);

    return next;
  });

  const forget = (id: number): void => void setLeaving((all) => {
    const next = new Set(all);

    next.delete(id);

    return next;
  });

  events.subscribe((event) => {
    if (event.name === "message.sent" || event.name === "message.held" || event.name === "message.dropped") {
      batch(() => {
        forget(event.data.id);
        upsert(event.data);
      });
    } else if (event.name === "message.delivered") {
      const message = event.data;
      const shown = messages().get(message.id);
      const glides = shown !== undefined && waiting(shown) && (watching.get(message.to) ?? 0) > 0 && !document.hidden && !reducedMotion();

      batch(() => {
        if (glides) setLeaving((all) => new Set(all).add(message.id));

        upsert(message);
      });
    }
  });

  /** The result of `run` in a box, or `null` once it was refused (its cause is then the Agent's failure). */
  const call = async <T,>(agent: string, run: () => Promise<T>): Promise<{ value: T } | null> => {
    if (daemonExit() !== null) return null;

    try {
      return { value: await run() };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      fail(agent, error.message);

      return null;
    }
  };

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
    draft: (agent) => drafts().get(agent) ?? "",
    setDraft: (agent, text) => setDrafts((all) => new Map(all).set(agent, text)),
    failure: (agent) => failures().get(agent) ?? null,
    watch: (agent) => {
      watching.set(agent, (watching.get(agent) ?? 0) + 1);

      return () => watching.set(agent, (watching.get(agent) ?? 1) - 1);
    },
    send: async (agent, now, kind) => {
      const body = drafts().get(agent) ?? "";

      if (body.trim() === "" || sending.has(agent)) return;

      sending.add(agent);
      fail(agent, null);

      try {
        const queued = await call(agent, () => app.rpc("message.send", { to: agent, kind: "note", body, replyTo: null }));

        if (queued === null) return;

        // Cleared when the result returns, unless the user has typed on since.
        if ((drafts().get(agent) ?? "") === body) setDrafts((all) => new Map(all).set(agent, ""));

        if (!now) return;

        const message = queued.value;

        // B6: a Takeover holds the note, and the user's call wins.
        if (message.status === "held" && message.reason === "takeover" && await call(agent, () => app.rpc("message.deliver", { id: message.id })) === null) return;

        // U3781: B2 takes the note at idle; interrupting would stop the turn it just started.
        if (kind !== "idle") await call(agent, () => app.rpc("agent.interrupt", { id: agent }));
      } finally {
        sending.delete(agent);
      }
    },
    remove: async (message) => {
      fail(message.to, null);
      await call(message.to, () => app.rpc("message.drop", { id: message.id }));
    },
    allow: async (message) => {
      fail(message.to, null);
      await call(message.to, () => app.rpc("message.deliver", { id: message.id }));
    },
    settle: forget,
  };
};

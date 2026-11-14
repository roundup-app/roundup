import { batch, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Message } from "@contracts/message/Message";
import { handleEvent, type EventHandlers, type Events } from "../app/events";
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

/** B1, B3563b: whether `message` waits in the queue: any Message to the Agent that is still pending. */
const waiting = (message: Message): boolean => message.status === "pending";

export const createNoteQueue = (app: AppSeam, events: Events, daemonExit: Accessor<DaemonExit | null>): NoteQueue => {
  const pending = new Map<string, Message[]>();
  const recipients = new Map<number, string>();
  // U5643b: lists never override an already observed id, even after its body is released.
  // This metadata lives with the connected Project, like loaded recipient state.
  const observed = new Set<number>();
  const [revision, changed] = createSignal(0);
  const [failures, setFailures] = createSignal<readonly NoteFailure[]>([]);
  const loaded = new Set<string>();

  const upsert = (message: Message): void => {
    observed.add(message.id);
    const previous = recipients.get(message.id);

    if (previous !== undefined) {
      const rows = pending.get(previous)!.filter(row => row.id !== message.id);

      if (rows.length === 0) pending.delete(previous);
      else pending.set(previous, rows);
      recipients.delete(message.id);
    }

    if (waiting(message)) {
      const rows = [...pending.get(message.to) ?? []];
      const position = rows.findIndex(row => row.id > message.id);
      rows.splice(position === -1 ? rows.length : position, 0, message);
      pending.set(message.to, rows);
      recipients.set(message.id, message.to);
    }

    if (previous !== undefined || waiting(message)) changed(value => value + 1);
  };

  let counter = 0;

  /** Replaces the failure of the same Agent and Message (or list) with `cause`, or only clears it when `cause` is `null`. */
  const fail = (agent: string, message: number | null, cause: string | null): void => void setFailures((all) => {
    const next = all.filter((failure) => failure.agent !== agent || failure.message !== message);

    return cause === null ? next : [...next, { key: ++counter, agent, message, cause }];
  });

  const clearMessage = (id: number): void => void setFailures((all) => all.filter((failure) => failure.message !== id));

  const settle = ({ data }: { data: Message }): void => batch(() => {
    clearMessage(data.id);
    upsert(data);
  });

  const handlers: EventHandlers = {
    "message.sent": ({ data }) => upsert(data),
    "message.dropped": settle,
    "message.delivered": settle,
  };

  events.subscribe(event => handleEvent(handlers, event));

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
    rows: (agent) => {
      revision();

      return [...pending.get(agent) ?? []];
    },
    load: (agent) => {
      if (loaded.has(agent) || daemonExit() !== null) return;

      loaded.add(agent);
      void app.rpc("message.list", { to: agent, status: null }).then((all) => {
        // An Event that came while the list was on its way is newer than the list.
        fail(agent, null, null);
        batch(() => {
          for (const message of all) if (!observed.has(message.id)) upsert(message);
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

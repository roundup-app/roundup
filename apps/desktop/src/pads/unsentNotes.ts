import { createSignal } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { Touch } from "@contracts/Touch";
import { reply } from "../changes/notes";
import { copy } from "./copy";
import type { AppSeam } from "../app/seam";
import type { ConnectedProject } from "../state/connectedProject";

/** U7705: a note on a span of a Pad's text, made on `revision`. */
export type PadNote = { id: number; revision: number; quote: string; text: string };

export type NoteSend = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; text: string };

/** The Actor of the newest `wrote` Touch; a `read` never counts. */
export const lastWriter = (history: readonly Touch[]): Actor | null =>
  history.reduce<Touch | null>((newest, touch) => touch.verb === "wrote" && (!newest || touch.at >= newest.at) ? touch : newest, null)?.actor ?? null;

/** The Message body is wire data for the receiving Agent: the Pad, the Revision, the quote and the comment, never commands. */
export const bodyOf = (pad: string, note: PadNote) => {
  const fields = { "Pad:": pad, "Revision:": String(note.revision), [`Quoted from Revision ${note.revision}:`]: note.quote, "User comment:": note.text };

  return Object.entries(fields).map(([label, value], index) => index < 2 ? `${label} ${value}` : `${label}\n${value}`).join("\n");
};

/** Unsent notes live for this App run, per Pad (P11); they are never part of the Pad's text. */
export const createPadNotes = () => {
  const [notes, setNotes] = createSignal<ReadonlyMap<string, readonly PadNote[]>>(new Map());
  const [sends, setSends] = createSignal<ReadonlyMap<string, NoteSend>>(new Map());
  let next = 0;

  const list = (pad: string) => notes().get(pad) ?? [];
  const send = (pad: string, id: number): NoteSend => sends().get(`${pad}:${id}`) ?? { kind: "idle" };
  const putSend = (pad: string, id: number, value: NoteSend) => setSends(new Map(sends()).set(`${pad}:${id}`, value));
  // A synchronous guard: a signal write is not read back until the next flush.
  const sending = new Set<string>();

  const remove = (pad: string, id: number) => setNotes(new Map(notes()).set(pad, list(pad).filter(note => note.id !== id)));

  const rekey = (from: string, to: string | null) => {
    const moved = notes().get(from);
    const next = new Map(notes());

    next.delete(from);

    if (to !== null && moved) next.set(to, moved);
    setNotes(next);
    setSends((current) => new Map([...current].flatMap(([key, value]): [string, NoteSend][] => {
      if (!key.startsWith(`${from}:`)) return [[key, value]];

      return to === null ? [] : [[`${to}${key.slice(from.length)}`, value]];
    })));
  };

  return {
    list, send,
    /** `pad.renamed` moves a Pad's notes to its new name; `pad.deleted` drops them (U7705f). */
    rename: (from: string, to: string) => rekey(from, to),
    drop: (pad: string) => rekey(pad, null),
    save: (pad: string, revision: number, quote: string, text: string) => setNotes(new Map(notes()).set(pad, [...list(pad), { id: ++next, revision, quote, text }])),
    remove,
    /** One `message.send`; accepted clears only this note, anything else keeps it with the failure and no resend. */
    deliver: async (app: AppSeam, pad: string, note: PadNote, to: string) => {
      const key = `${pad}:${note.id}`;

      if (sending.has(key)) return;
      sending.add(key);
      putSend(pad, note.id, { kind: "pending" });

      try {
        const result = await reply(() => app.rpc("message.send", { to, kind: "note", body: bodyOf(pad, note), replyTo: null }));

        if (result.kind === "ok") { remove(pad, note.id); putSend(pad, note.id, { kind: "idle" }); } else putSend(pad, note.id, { kind: "failed", text: result.text });
      } finally { sending.delete(key); }
    },
  };
};

export type PadNotes = ReturnType<typeof createPadNotes>;

const stores = new WeakMap<Pick<ConnectedProject, "events">, PadNotes>();

/** The store a connected Project keeps, so a Drawer reopened (or another Pad opened) finds its notes. */
export const padNotesOf = (owner: Pick<ConnectedProject, "events">): PadNotes => {
  let store = stores.get(owner);

  if (!store) {
    const created = createPadNotes();

    // The store lives as long as its Project, so the subscription needs no owner to end it.
    owner.events.subscribe((event) => {
      if (event.name === "pad.renamed") created.rename(event.data.previous_name, event.data.name);
      else if (event.name === "pad.deleted") created.drop(event.data.name);
    });
    store = created;
    stores.set(owner, store);
  }

  return store;
};

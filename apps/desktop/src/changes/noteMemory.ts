import { createReadYourWrites } from "./readYourWrites";

/** U7676c, U7676d: what the notes bar remembers beside the batch: the count restored at start, and the notes removed in the last 5 s. */
export const createNoteMemory = <Note extends object>(restored: ReadonlyMap<string, { notes: readonly unknown[] }>, restore: (id: string, note: Note) => Promise<void>) => {
  const [kept, holdKept] = createReadYourWrites(new Map([...restored].flatMap(([id, value]) => value.notes.length ? [[id, value.notes.length] as const] : [])));

  const [gone, holdGone] = createReadYourWrites(new Map<string, readonly { note: Note; timer: ReturnType<typeof setTimeout> }[]>());

  const unkeep = (id: string) => { if (kept().has(id)) holdKept(new Map([...kept()].filter(([key]) => key !== id))); };

  const forget = (id: string, note: Note) => holdGone(new Map(gone()).set(id, (gone().get(id) ?? []).filter(entry => entry.note !== note)));

  /** Brings back the latest removed note still inside its 5 s. */
  const undo = async (id: string) => {
    const entry = (gone().get(id) ?? []).at(-1);

    if (!entry) return;
    clearTimeout(entry.timer);
    forget(id, entry.note);
    unkeep(id);
    await restore(id, entry.note);
  };

  return {
    undo,
    kept: (id: string) => kept().get(id) ?? 0,
    unkeep,
    gone: (id: string) => gone().get(id) ?? [],
    forget,
    removedNote: (id: string, note: Note) => holdGone(new Map(gone()).set(id, [...(gone().get(id) ?? []), { note, timer: setTimeout(() => forget(id, note), 5000) }])),
  };
};

/** What a note says of itself: Sending and Send unknown lock it; Couldn't send keeps it editable. */
export const noteStateOf = (submissions: readonly { status: string; notes: readonly { id: number }[] }[], send: { kind: string; notes?: readonly number[] | null } | undefined, note: { id: number }): "sending" | "unknown" | "failed" | "unsent" => {
  const submission = submissions.find(value => value.notes.some(each => each.id === note.id));

  if (submission?.status === "pending") return "sending";

  if (submission?.status === "unknown") return "unknown";

  return send?.kind === "failed" && (send.notes === null || send.notes?.includes(note.id)) ? "failed" : "unsent";
};

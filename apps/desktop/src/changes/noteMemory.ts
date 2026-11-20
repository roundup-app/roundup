import type { Note } from "./notes";
import { createReadYourWrites } from "./readYourWrites";

/** U7676c, U7676d: what the notes bar remembers beside the batch: the count restored at start, and the notes removed in the last 5 s. */
export const createNoteMemory = (restored: ReadonlyMap<string, { notes: readonly unknown[] }>) => {
  const [kept, holdKept] = createReadYourWrites(new Map([...restored].flatMap(([id, value]) => value.notes.length ? [[id, value.notes.length] as const] : [])));

  const [gone, holdGone] = createReadYourWrites(new Map<string, readonly { note: Note; timer: ReturnType<typeof setTimeout> }[]>());

  const forget = (id: string, note: Note) => holdGone(new Map(gone()).set(id, (gone().get(id) ?? []).filter(entry => entry.note !== note)));

  return {
    kept: (id: string) => kept().get(id) ?? 0,
    unkeep: (id: string) => { if (kept().has(id)) holdKept(new Map([...kept()].filter(([key]) => key !== id))); },
    gone: (id: string) => gone().get(id) ?? [],
    forget,
    removedNote: (id: string, note: Note) => holdGone(new Map(gone()).set(id, [...(gone().get(id) ?? []), { note, timer: setTimeout(() => forget(id, note), 5000) }])),
  };
};

import { createSignal } from "solid-js";
import type { Actor } from "@contracts/Actor";

/** One Pad's save cycle: exactly one of these holds at a time. */
export type Save =
  | { kind: "clean" }
  | { kind: "dirty"; due: "autosave" | "keep-mine" | null }
  | { kind: "sending"; text: string; version: number }
  | { kind: "conflict"; actor: Actor | "unknown"; version: number }
  /** An unknown reply or a recovered draft: the user chooses. */
  | { kind: "paused" }
  | { kind: "deleted"; byMe: boolean };

export type SaveEvent =
  | { kind: "edited" }
  /** Blur, the autosave pause or an explicit Keep mine asks for a write. */
  | { kind: "due"; due: "autosave" | "keep-mine" }
  | { kind: "send"; text: string; version: number; mine: boolean }
  | { kind: "applied"; version: number }
  | { kind: "refused" }
  /** Nothing to send after all: a due write that finds the text unchanged or unmappable. */
  | { kind: "skipped" }
  | { kind: "unknown" }
  | { kind: "external"; actor: Actor | "unknown"; version: number }
  | { kind: "resume" }
  /** The text now equals the Pad's, by choosing theirs or by a settled write. */
  | { kind: "settled" }
  | { kind: "gone"; byMe: boolean }
  /** The same incarnation is listed again, as after an undo of the delete. */
  | { kind: "back" };

/** Only Keep mine sends out of a conflict; a pause is left by Resume or Keep mine. */
export const step = (save: Save, event: SaveEvent): Save => {
  if (save.kind === "deleted") return event.kind === "back" ? { kind: "clean" } : event.kind === "gone" ? { kind: "deleted", byMe: save.byMe || event.byMe } : save;

  switch (event.kind) {
    case "gone": return { kind: "deleted", byMe: event.byMe };
    case "settled": return { kind: "clean" };
    case "back": return save;
    case "external": return { kind: "conflict", actor: event.actor, version: event.version };
    case "skipped": return save.kind === "dirty" ? { kind: "dirty", due: null } : save;
    case "edited": return save.kind === "clean" ? { kind: "dirty", due: null } : save.kind === "dirty" && save.due !== "keep-mine" ? { kind: "dirty", due: null } : save;
    case "due":
      if (event.due === "keep-mine") return save.kind === "sending" || save.kind === "conflict" ? save : { kind: "dirty", due: "keep-mine" };

      return save.kind === "dirty" ? { kind: "dirty", due: save.due ?? "autosave" } : save;
    case "send": return save.kind === "dirty" && save.due !== null || save.kind === "conflict" && event.mine ? { kind: "sending", text: event.text, version: event.version } : save;
    case "applied": return save.kind === "sending" && save.version === event.version ? { kind: "clean" } : save;
    case "refused": return save.kind === "sending" ? { kind: "dirty", due: null } : save;
    case "unknown": return save.kind === "sending" ? { kind: "paused" } : save;
    case "resume": return save.kind === "paused" ? { kind: "dirty", due: "autosave" } : save;
  }
};

/** The save cycle as a signal; `version` numbers the external changes so an older reply is told from a newer one. */
export const createSave = (initial: Save) => {
  const [save, set] = createSignal(initial);
  let version = 0;

  return {
    save,
    version: () => version,
    next: () => ++version,
    send: (event: SaveEvent) => set(previous => step(previous, event)),
  };
};

import { createSignal } from "solid-js";
import type { Actor } from "@contracts/Actor";

/** One Pad's save cycle: exactly one of these holds at a time. */
export type Save =
  | { kind: "clean" }
  | { kind: "dirty"; due: "autosave" | "keep-mine" | null }
  /** `over`: the conflict still shown until the reply, one this write resolves or one that arrived while it was in flight.
   * `due`: a write was asked for in flight and follows the reply; only Keep mine writes over a newer change. */
  | { kind: "sending"; text: string; version: number; over?: Actor | "unknown"; due?: "autosave" | "keep-mine" }
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

type Handlers = { [K in SaveEvent["kind"]]: (save: Save, event: Extract<SaveEvent, { kind: K }>) => Save };

const dirty = (due: "autosave" | "keep-mine" | null): Save => ({ kind: "dirty", due });

const handlers: Handlers = {
  gone: (_, event) => ({ kind: "deleted", byMe: event.byMe }),
  settled: () => ({ kind: "clean" }),
  back: save => save,
  // A change during a write waits for that write's reply, which then cannot clean it.
  external: (save, event) => save.kind === "sending"
    ? { ...save, over: event.actor, version: event.version }
    : { kind: "conflict", actor: event.actor, version: event.version },
  skipped: save => save.kind === "dirty" ? dirty(null) : save,
  edited: save => save.kind === "clean" || save.kind === "dirty" && save.due !== "keep-mine" ? dirty(null) : save,
  due: (save, event) => {
    if (event.due === "keep-mine") {
      if (save.kind === "sending") return save.over === undefined ? save : { ...save, due: "keep-mine" };

      return save.kind === "conflict" ? save : dirty("keep-mine");
    }

    if (save.kind === "sending") return { ...save, due: save.due ?? "autosave" };

    return save.kind === "dirty" ? dirty(save.due ?? "autosave") : save;
  },
  send: (save, event) => {
    if (!(save.kind === "dirty" && save.due !== null || save.kind === "conflict" && event.mine)) return save;

    return { kind: "sending", text: event.text, version: event.version, ...save.kind === "conflict" && { over: save.actor } };
  },
  applied: (save, event) => {
    if (save.kind !== "sending") return save;

    if (save.version === event.version) return save.due ? dirty(save.due) : { kind: "clean" };

    return save.due === "keep-mine" ? dirty("keep-mine") : { kind: "conflict", actor: save.over ?? "unknown", version: save.version };
  },
  refused: save => {
    if (save.kind !== "sending") return save;

    return save.over === undefined ? dirty(null) : { kind: "conflict", actor: save.over, version: save.version };
  },
  unknown: save => save.kind === "sending" ? { kind: "paused" } : save,
  resume: save => save.kind === "paused" ? dirty("autosave") : save,
};

/** Only Keep mine sends out of a conflict; a pause is left by Resume or Keep mine. */
export const step = (save: Save, event: SaveEvent): Save => {
  if (save.kind !== "deleted") {
    // SAFETY: `handlers` is keyed by event kind, so the entry for `event.kind` takes exactly that event.
    return (handlers[event.kind] as (save: Save, event: SaveEvent) => Save)(save, event);
  }


  if (event.kind === "back") return { kind: "clean" };

  return event.kind === "gone" ? { kind: "deleted", byMe: save.byMe || event.byMe } : save;
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

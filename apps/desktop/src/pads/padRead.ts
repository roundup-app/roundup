import { createEffect, createSignal, type Accessor } from "solid-js";
import * as v from "valibot";
import type { Pad } from "@contracts/pad/Pad";
import { useConnectedProject, type ConnectedProject } from "../state/connectedProject";
import { storageSchema, storedValue } from "../state/storage";
import { usePadList, type PadList } from "./padList";

/** U7499b: the Revision of each Pad (by incarnation) the user last read, per original Project. */
const readSchema = storageSchema("roundup:pad-read", v.record(v.string(), v.pipe(v.string(), v.regex(/^\d+$/))));

export const padReadStorage = (path: string) => storedValue(`roundup:pad-read:${path}`, readSchema);

/** U7706a: the text of the Revision each Pad was last read at, kept beside the record so a change can be shown against it. */
const textSchema = storageSchema("roundup:pad-read-text", v.record(v.string(), v.string()));

export const padReadTextStorage = (path: string) => storedValue(`roundup:pad-read-text:${path}`, textSchema);

/** A Pad over this many characters keeps no earlier text. */
export const keptTextCap = 100_000;

export type PadMark = "new" | "changed" | null;

export type PadRead = {
  /** Read when the recorded Revision equals the current one. */
  isRead(pad: Pad): boolean;
  /** `new` when the user never read the Pad, `changed` when it changed since they did. */
  mark(pad: Pad): PadMark;
  /** U7706a: the text of the Revision the user read, or null when none was kept. */
  kept(pad: Pad): string | null;
  /** Takes the Pad's current Revision: the Drawer opened on it, the user saved, or the Drawer left it. */
  record(pad: Pad): void;
  /** A Pad the user creates is read at its creation: it takes its Revision when the list first holds it. */
  created(name: string): void;
  /** The name of the Pad the Drawer shows, which keeps its place on the Pads tab. */
  open: Accessor<string | null>;
  setOpen(name: string | null): void;
};

type Shared = { read: PadRead; settle: (pads: readonly Pad[]) => void };

const shared = new WeakMap<ConnectedProject, Shared>();

const make = (path: string): Shared => {
  const storage = padReadStorage(path);
  const saved = storage.read();
  const [revisions, setRevisions] = createSignal<Record<string, string>>(saved ?? {});
  const [open, setOpen] = createSignal<string | null>(null);
  const textStorage = padReadTextStorage(path);
  const [texts, setTexts] = createSignal<Record<string, string>>(textStorage.read() ?? {});
  let baselined = saved !== null;
  const waiting = new Set<string>();

  const write = (changes: Record<string, string>, taken: readonly Pad[]) => {
    const next = { ...revisions(), ...changes };
    const kept = { ...texts() };

    for (const pad of taken) {
      if (pad.text.length > keptTextCap) delete kept[pad.incarnation];
      else kept[pad.incarnation] = pad.text;
    }

    setRevisions(next);
    storage.write(next);
    setTexts(kept);
    textStorage.write(kept);
  };

  // The first answered list of a Project with no record, even an empty one, counts every Pad as read.
  const settle = (pads: readonly Pad[]) => {
    if (!baselined) {
      baselined = true;
      write(Object.fromEntries(pads.map(pad => [pad.incarnation, String(pad.revision)])), pads);

      return;
    }

    const mine = pads.filter(pad => waiting.has(pad.name));

    for (const pad of mine) waiting.delete(pad.name);

    if (mine.length > 0) write(Object.fromEntries(mine.map(pad => [pad.incarnation, String(pad.revision)])), mine);
  };

  const read: PadRead = {
    isRead: pad => revisions()[pad.incarnation] === String(pad.revision),
    mark: pad => {
      const recorded = revisions()[pad.incarnation];

      return recorded === undefined ? "new" : recorded === String(pad.revision) ? null : "changed";
    },
    kept: pad => revisions()[pad.incarnation] === undefined ? null : texts()[pad.incarnation] ?? null,
    record: pad => { if (revisions()[pad.incarnation] !== String(pad.revision) || (texts()[pad.incarnation] === undefined && pad.text.length <= keptTextCap)) write({ [pad.incarnation]: String(pad.revision) }, [pad]); },
    created: name => { waiting.add(name); },
    open,
    setOpen: name => { setOpen(name); },
  };

  return { read, settle };
};

/** The Project's read record, kept by the App as unread finishes are (U3566); no RPC reads or writes it. */
export const usePadRead = (list: PadList = usePadList()): PadRead => {
  const connected = useConnectedProject();
  const entry = shared.get(connected) ?? make(connected.project.path);

  shared.set(connected, entry);
  createEffect(() => list.loaded() ? list.pads() : null, pads => { if (pads) entry.settle(pads); });

  return entry.read;
};

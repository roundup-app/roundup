import { filesOf, isItem } from "./notes";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { Item, ItemNote, Note } from "./notes";
import type { ModuleGroup } from "./modules";

/** U7691a: what a note on an item names: the item's kind and `name`, the words it shows, and the files it holds now. */
export type ItemTarget = {
  kind: Item["kind"];
  name: string;
  title: string;
  files: readonly ChangedFile[];
};

/** U7691a: a module or a flow of a lens takes a note; Unplaced and Not traced, which are no flow, take none. */
export const groupTarget = (group: ModuleGroup): ItemTarget | undefined => {
  if (group.untraced || group.name === "~unplaced") return undefined;

  return {
    kind: group.name.startsWith("~") ? "flow" : "module",
    name: group.name,
    title: group.label ?? group.name,
    files: group.files,
  };
};

export const fileTarget = (file: ChangedFile): ItemTarget => ({
  kind: "file",
  name: file.path,
  title: file.path,
  files: [file],
});

export const sameItem = (
  left: Pick<Item, "kind" | "name">,
  right: Pick<Item, "kind" | "name">,
) => left.kind === right.kind && left.name === right.name;

/** What a note records of an item: each file's `blob` now (#7680), the signal for Outdated. */
export const itemOf = (target: ItemTarget): Item => ({
  kind: target.kind,
  name: target.name,
  title: target.title,
  blobs: Object.fromEntries(target.files.map((file) => [file.path, file.blob])),
});

/** U7691a: what a scroll takes a note as: its module or flow, else the noise file it shows. */
export const paneTarget = (group: ModuleGroup | undefined, file: ChangedFile | undefined) => group ? groupTarget(group) : file && fileTarget(file);

/** U7691c: a flow is listed while a finished trace (or, for a readback's flow, a finished readback) holds it; `undefined` until one has finished. */
export const flowListed = (item: Item, finished: { traced: boolean; read: boolean }, flows: () => readonly ModuleGroup[]) => {
  if (item.kind !== "flow") return true;

  if (!(item.name.startsWith("~read:") ? finished.read : finished.traced)) return undefined;

  return flows().some(flow => flow.name === item.name);
};

/** The item notes of one Agent's batch. */
export const itemNotes = (notes: readonly Note[]) => notes.filter(isItem);

/**
 * U7691c: a Sent item note is Outdated when a file it recorded lists another `blob` or no longer lists, or when its flow is gone; `exists` answers undefined until a trace or readback has finished.
 */
export const outdatedItem = (
  note: ItemNote,
  files: readonly ChangedFile[],
  exists: (item: Item) => boolean | undefined,
) =>
  note.sent !== undefined &&
  (filesOf(note.item).some(
    (path) =>
      files.find((file) => file.path === path)?.blob !== note.item.blobs[path],
  ) ||
    exists(note.item) === false);

/** U7691d: how many item notes a row counts: those on its item, and those on a file it holds. */
export const countFor = (
  notes: readonly ItemNote[],
  group: Pick<ModuleGroup, "name" | "files">,
) =>
  notes.filter((note) =>
    note.item.kind === "file"
      ? group.files.some((file) => file.path === note.item.name)
      : note.item.name === group.name,
  ).length;

import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { LENSES, type Lens } from "./lens";
import type { ModuleGroup } from "./modules";

/** U7680c: what one Agent's view recorded: the `blob` each file had when it was marked Viewed, and the files whose mark a change removed. Each key names a comparison and a path. */
export type Seen = { marks: ReadonlyMap<string, string | null>; changed: ReadonlySet<string> };

export const NOTHING_SEEN: Seen = { marks: new Map(), changed: new Set() };

/** U7680c: the comparison a mark belongs to: the Compare-to value, and the group when the Agent's own changes are shown. */
export const comparisonOf = (target: string, group?: { repo: string; branch: string }) => `${target}\0${group ? `${group.repo}\0${group.branch}` : ""}`;

const keyOf = (comparison: string, path: string) => `${comparison}\0${path}`;

const keysOf = (comparison: string, files: readonly ChangedFile[]) => new Set(files.map(file => keyOf(comparison, file.path)));

/** U7680a: an item is viewed when each file it lists holds the `blob` it was marked with. */
export const isViewed = (seen: Seen, comparison: string, files: readonly ChangedFile[]) => files.length > 0 && files.every(file => seen.marks.get(keyOf(comparison, file.path)) === file.blob);

/** U7680d: an item that lists a file whose mark a change removed. */
export const isChanged = (seen: Seen, comparison: string, files: readonly ChangedFile[]) => files.some(file => seen.changed.has(keyOf(comparison, file.path)));

/** U7680a: each file marked with its `blob`, and the words about a change cleared. */
export const mark = (seen: Seen, comparison: string, files: readonly ChangedFile[]): Seen => {
  const keys = keysOf(comparison, files);

  return { marks: new Map([...seen.marks, ...files.map(file => [keyOf(comparison, file.path), file.blob] as const)]), changed: new Set([...seen.changed].filter(key => !keys.has(key))) };
};

export const unmark = (seen: Seen, comparison: string, files: readonly ChangedFile[]): Seen => {
  const keys = keysOf(comparison, files);

  return { marks: new Map([...seen.marks].filter(([key]) => !keys.has(key))), changed: seen.changed };
};

/** U7680d: a listing drops the marks of its comparison whose file has another `blob` or has left, and says so for a file that is still listed. */
export const reconcile = (seen: Seen, comparison: string, files: readonly ChangedFile[]): Seen => {
  const listed = new Map(files.map(file => [keyOf(comparison, file.path), file.blob] as const));
  const prefix = `${comparison}\0`;
  const stale = new Set([...seen.marks].flatMap(([key, blob]) => key.startsWith(prefix) && listed.get(key) !== blob ? [key] : []));

  if (stale.size === 0) return seen;

  return { marks: new Map([...seen.marks].filter(([key]) => !stale.has(key))), changed: new Set([...seen.changed, ...[...stale].filter(key => listed.has(key))]) };
};

/** U7680a: how many of the lens's modules are viewed, and how many it has. */
export const progressOf = (seen: Seen, comparison: string, modules: readonly ModuleGroup[]) => ({ viewed: modules.filter(module => isViewed(seen, comparison, module.files)).length, total: modules.length });

/** U7680b: after `after` in `from`'s list the first item not viewed, else the first one of each lens that follows in the switch's order, wrapping: an item skipped earlier is in another lens's list too, since a lens holds the files of its items. */
export const nextUnviewed = (from: Lens, after: string, entries: (lens: Lens) => readonly { key: string; viewed: boolean }[]): { lens: Lens; key: string } | undefined => {
  const at = LENSES.indexOf(from);

  for (const [pass, lens] of [...LENSES.slice(at), ...LENSES.slice(0, at)].entries()) {
    const list = entries(lens);
    const found = list.slice(pass === 0 ? list.findIndex(entry => entry.key === after) + 1 : 0).find(entry => !entry.viewed);

    if (found) return { lens, key: found.key };
  }

  return undefined;
};

// fallow-ignore-file duplicate-export -- absolutePath joins a ChangedFile to its Project; terminal/links resolves Terminal links. Imports are direct.
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { ChangedStatus } from "@contracts/agent/ChangedStatus";
import { copy } from "./copy";

/** The word on a file's row for its status. */
export const statusText: Record<ChangedStatus, string> = {
  added: copy.statusNew,
  modified: copy.statusModified,
  renamed: copy.statusRenamed,
  deleted: copy.statusDeleted,
  untracked: copy.statusNew,
};

/** A file the Agent created: git lists a staged one as added and one it never staged as untracked. */
export const isNew = (status: ChangedStatus | null): boolean => status === "added" || status === "untracked";

/** The absolute path of a changed file in the Worktree at `root`. */
export const changedPath = (root: string, file: ChangedFile): string => `${root.replace(/\/+$/, "")}/${file.path}`;

// fallow-ignore-file duplicate-export -- ChangedFile resolution differs from terminal/links printed-path normalization; imports name the module.
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { ChangedStatus } from "@contracts/agent/ChangedStatus";
import { copy } from "../copy";

/** The word on a file's row for its status. */
export const statusText: Record<ChangedStatus, string> = {
  added: copy.statusAdded,
  modified: copy.statusModified,
  renamed: copy.statusRenamed,
  deleted: copy.statusDeleted,
  untracked: copy.statusUntracked,
};

/** The absolute path of a changed file in the Worktree at `root`. */
export const absolutePath = (root: string, file: ChangedFile): string => `${root.replace(/\/+$/, "")}/${file.path}`;

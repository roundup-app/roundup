import { copy as sharedCopy } from "../sharedCopy";

export const storageCopy = {
  incompatible: sharedCopy.storageIncompatible,
  restoreFailure: (cause: string) => `Could not restore saved work: ${cause}.`,
  readFailure: (cause: string) => `Could not read saved work: ${cause}.`,
  notRestored: "Saved work is still restoring.",
  replaced: "Saving was interrupted. Retry saving your work.",
  changed: "Saved work was changed. Review it before retrying.",
} as const;

export const copy = {
  actionsUnregistered: "The App could not register its actions.",
  projectNoLongerOpen: "Project is closed.",
  terminalOutcomeUnknown: sharedCopy.terminalOutcomeUnknown,
  renameDidNotApply: (asked: string, kept: string) => `Rename to ${asked} did not apply; ${kept} was kept. Rename again.`,
  moveDidNotApply: "The move did not apply; the row stayed where it was. Move it again.",
  keep: sharedCopy.keep,
  newWorkstreamTitle: sharedCopy.newWorkstreamTitle,
  worktreeReadUnavailable: sharedCopy.worktreeReadUnavailable,
  theDoorDidNotStartInTimeRetry: "It did not start in time. Retry.",
  askNoAcknowledgement: "not found yet",
} as const;

import { copy as sharedCopy } from "../sharedCopy";

export const storageCopy = {
  invalid: (label: string) => `Could not restore ${label}. The saved format is invalid. Retry or continue; the original data is kept.`,
  recoveryFailure: (label: string, cause: string) => `A recovery copy is unavailable for ${label}: ${cause}. Try again.`,
  recoveryReadback: "Could not verify the saved recovery copy. Retry restoring saved work.",
  restoreFailure: (cause: string) => `Could not restore saved work: ${cause}.`,
  readFailure: (cause: string) => `Could not read saved work: ${cause}.`,
  notRestored: "Saved work is still restoring.",
  replaced: "Saving was interrupted. Retry saving your work.",
  changed: "Saved work was changed. Review it before retrying.",
} as const;

export const copy = {
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

import { labels, copy as sharedCopy } from "../sharedCopy";

export const storageCopy = {
  invalid: (key: string) => `Could not restore saved ${labels.get(key.split(":")[1] ?? "") ?? "settings"} because the saved format is invalid. Retry or continue; the original data will be kept for recovery.`,
  recoveryFailure: (key: string, cause: string) => `Could not keep a copy of saved ${labels.get(key.split(":")[1] ?? "") ?? "settings"}: ${cause}`,
  recoveryReadback: "Could not verify the saved recovery copy. Retry restoring saved work.",
  restoreFailure: (cause: string) => `Could not restore saved work: ${cause}`,
  readFailure: (cause: string) => `Could not read saved work: ${cause}`,
  notRestored: "Saved work has not finished restoring",
  replaced: "Saving was interrupted. Retry saving your work.",
  changed: "Saved work changed before saving. Review the current work before retrying.",
} as const;

export const copy = {
  projectNoLongerOpen: "Project is no longer open",
  terminalOutcomeUnknown: sharedCopy.terminalOutcomeUnknown,
  keep: sharedCopy.keep,
  newWorkstreamTitle: sharedCopy.newWorkstreamTitle,
  worktreeReadUnavailable: sharedCopy.worktreeReadUnavailable,
  theDoorDidNotStartInTimeRetry: "Did not start in time; retry",
  askNoAcknowledgement: "not found yet",
} as const;

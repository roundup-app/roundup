import { labels, copy as sharedCopy } from "../sharedCopy";

const fallbackLabel = "settings";

export const storageCopy = {
  invalid: (key: string) => `Could not restore ${labels.get(key.split(":")[1] ?? "") ?? fallbackLabel}. The saved format is invalid. Retry or continue; the original data is kept.`,
  recoveryFailure: (key: string, cause: string) => `A recovery copy is unavailable for ${labels.get(key.split(":")[1] ?? "") ?? fallbackLabel}: ${cause}. Try again.`,
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
  keep: sharedCopy.keep,
  newWorkstreamTitle: sharedCopy.newWorkstreamTitle,
  worktreeReadUnavailable: sharedCopy.worktreeReadUnavailable,
  theDoorDidNotStartInTimeRetry: "It did not start in time. Retry.",
  askNoAcknowledgement: "not found yet",
} as const;

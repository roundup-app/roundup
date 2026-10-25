const labels = new Map([
  ["open-tab", "the selected Project"], ["unseen", "read markers"], ["drafts", "drafts"],
  ["import", "imported work"], ["rail", "Rail layout"], ["app-settings", "settings"],
  ["widths", "panel widths"], ["shelf", "Shelf settings"], ["terminal-font", "Terminal text size"],
 ]);

/** Copy for restoring and retaining saved work. Draft recovery labels stay with the draft catalogue. */
export const storageCopy = {
  invalid: (key: string) => `Could not restore saved ${labels.get(key.split(":")[1] ?? "") ?? "settings"} because their format is invalid. Retry or continue without them; the original data will be kept for recovery.`,
  continue: (key: string) => key.startsWith("roundup:drafts:") ? "Continue without these saved drafts" : "Continue without these settings",
  retained: (key: string) => `Saved ${labels.get(key.split(":")[1] ?? "") ?? "settings"} could not be restored because their format is invalid. Copy the original data for recovery.`,
  recoveryCopy: "Copy original data",
  recoveryReadback: "Could not verify the saved recovery copy. Retry restoring saved work.",
  restoreFailure: (cause: string) => `Could not restore saved work: ${cause}`,
  readFailure: (cause: string) => `Could not read saved work: ${cause}`,
  notRestored: "Saved work has not finished restoring",
  replaced: "Saving was interrupted. Retry saving your work.",
  changed: "Saved work changed before saving. Review the current work before retrying.",
  restoring: "Restoring saved work…",
  restoreRetry: "Retry restoring saved work",
  saveRetry: "Retry saving",
  failure: (problems: readonly { key: string; cause: string }[]) => {
    const work = [...new Set(problems.map(problem => labels.get(problem.key.split(":")[1] ?? "") ?? "saved work"))];
    const causes = [...new Set(problems.map(problem => problem.cause))];

    return `Could not save ${work.join(", ")}: ${causes.join("; ")}`;
  },
} as const;

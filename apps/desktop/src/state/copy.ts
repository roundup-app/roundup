/** Copy for restoring and retaining saved work. Draft recovery labels stay with the draft catalogue. */
export const storageCopy = {
  restoreFailure: (cause: string) => `Could not restore saved work: ${cause}`,
  readFailure: (cause: string) => `Could not read saved work: ${cause}`,
  notRestored: "Saved work has not finished restoring",
  replaced: "Saved work belongs to a replaced browser adapter",
  changed: "Stored work changed before persistence",
  restoring: "Restoring saved work…",
  restoreRetry: "Retry restoring saved work",
  saveRetry: "Retry saving",
  failure: (cause: string) => `Could not retain saved work: ${cause}`,
} as const;

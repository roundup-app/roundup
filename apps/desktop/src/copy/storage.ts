/** Copy for restoring and retaining saved work. Draft recovery labels stay with the draft catalogue. */
export const storageCopy = {
  restoreFailure: (cause: string) => `Could not restore saved work: ${cause}`,
  readFailure: (cause: string) => `Could not read saved work: ${cause}`,
  notRestored: "Saved work has not finished restoring",
  replaced: "Saving was interrupted. Retry saving your work.",
  changed: "Saved work changed before saving. Review the current work before retrying.",
  restoring: "Restoring saved work…",
  restoreRetry: "Retry restoring saved work",
  saveRetry: "Retry saving",
  failure: (problems: readonly { key: string; cause: string }[]) => {
    const labels: Record<string, string> = {
      "open-tab": "the selected Project", unseen: "read markers", drafts: "drafts",
      import: "imported work", rail: "Rail layout", "app-settings": "settings",
      widths: "panel widths", shelf: "work item layout", "terminal-font": "Terminal text size",
    };
    const work = [...new Set(problems.map(problem => labels[problem.key.split(":")[1] ?? ""] ?? "saved work"))];
    const causes = [...new Set(problems.map(problem => problem.cause))];

    return `Could not save ${work.join(", ")}: ${causes.join("; ")}`;
  },
} as const;

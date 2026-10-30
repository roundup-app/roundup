import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  switcherRetentionFailure: (operation: "restore" | "retain", project: string) => operation === "restore"
    ? `Your saved search in ${project} could not be restored. Try again to recover it.`
    : `Your search in ${project} won't be kept after reload. Keep this Project open to recover your work.`,
  switcherCopyFailure: "Could not copy query. Select the text and copy again.",
  copyQuery: "Copy query",
  retryStorage: sharedCopy.retryStorage,
  queryCopied: "Copied",
  discardQuery: "Discard query",
  close: sharedCopy.close,
  switcherActions: "Actions",
  switcherLabel: "Switch to",
  switcherPlaceholder: sharedCopy.switcherPlaceholder,
  noMatch: sharedCopy.noMatch,
} as const;

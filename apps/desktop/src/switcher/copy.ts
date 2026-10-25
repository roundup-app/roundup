import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  close: shared.close,
  retryStorage: shared.retryStorage,
  switcherActions: "Actions",
  switcherLabel: "Switch to",
  switcherPlaceholder: shared.name,
  noMatch: shared.noMatch,
  switcherRetentionFailure: (operation: "restore" | "retain", project: string) => operation === "restore"
    ? `Your saved search in ${project} could not be restored. Try again to recover it.`
    : `Your search in ${project} won't be kept after reload. Keep this Project open to recover your work.`,
  queryCopied: shared.queryCopied,
  copyQuery: "Copy query",
  discardQuery: "Discard query",
  switcherCopyFailure: "Could not copy query. Select the text and copy again.",
} as const;

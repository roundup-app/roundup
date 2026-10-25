/** App-authored switcher copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

export const copy = {
  retryStorage: shared.retryStorage,
  queryCopied: shared.queryCopied,
  close: shared.close,

  switcherPlaceholder: shared.name,
  noMatch: shared.noMatch,
  /** @prose */
  switcherRetentionFailure: (operation: "restore" | "retain", project: string) => operation === "restore"
    ? `Your saved search in ${project} could not be restored. Try again to recover it.`
    : `Your search in ${project} won't be kept after reload. Keep this Project open to recover your work.`,
  /** @prose */
  switcherCopyFailure: "The query could not be copied. Select the text and copy again.",
  copyQuery: "Copy query",
  discardQuery: "Discard query",
  switcherActions: "Actions",
  switcherLabel: "Switch to",
} as const;

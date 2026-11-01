import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  switcherRetentionFailure: (operation: "restore" | "retain", project: string) => operation === "restore"
    ? `Your saved search in ${project} could not be restored. Try again to recover it.`
    : `Your search in ${project} won't be kept after reload. Keep this Project open to recover your work.`,
  switcherCopyFailure: "Copy failed. Select the text and copy it yourself.",
  copyQuery: "Copy query",
  retryStorage: sharedCopy.retryStorage,
  queryCopied: sharedCopy.copied,
  discardQuery: "Discard query",
  close: sharedCopy.close,
  switcherActions: "Actions",
  footerMove: "move",
  footerChoose: "choose",
  footerClose: "close",
  footerRecord: "Set key",
  pressAKey: "Press a key",
  refused: (cause: string) => `✕ ${cause}`,
  switcherLabel: "Switch to",
  switcherPlaceholder: sharedCopy.switcherPlaceholder,
  noMatch: sharedCopy.noMatch,
} as const;

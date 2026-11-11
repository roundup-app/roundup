import { labels, copy as sharedCopy, type CopyValue } from "../sharedCopy";

export const storageCopy = {
  saveRetry: "Retry saving",
  /** @prose */
  failure: (problems: readonly { key: string; cause: string }[]) => {
    const work = [...new Set(problems.map(problem => labels.get(problem.key.split(":")[1] ?? "") ?? "saved work"))];
    const causes = [...new Set(problems.map(problem => problem.cause))];

    return `Could not save ${work.join(", ")}: ${causes.join("; ")}. Retry saving.`;
  },
} as const;

export const copy = {
  captureOff: (cause: string) => `Quick capture could not start. ${cause}`,
  resources: sharedCopy.resources,
  switchProject: sharedCopy.switchProject,
  closeView: sharedCopy.closeView,
  rpcFailure: sharedCopy.rpcFailure,
  deliverables: sharedCopy.deliverables,
  dismissFailure: sharedCopy.dismissFailure,
  openDraft: sharedCopy.openDraft,
  openEvidence: sharedCopy.openEvidence,
  loadingProject: "Loading Project…",
  recoverNotes: sharedCopy.recoverNotes,
  todoDeleteRetry: sharedCopy.todoDeleteRetry,
  quitAndRunJustAppAgainToRebuild: "Quit and run `just app` again to rebuild it.",
  theDaemonIsOlderThanTheApp: (value1: CopyValue) => `This App is newer than the connected version. ${value1}`,
  theDaemonIsNewerThanTheApp: (value1: CopyValue) => `This App is older than the connected version. ${value1}`,
  theAppAndTheDaemonDiffer: (value1: CopyValue) => `The versions differ. ${value1}`,
  theAppAndTheDaemonDiffer2: (value1: CopyValue, value2: CopyValue) => `${value1}: The versions differ. ${value2}`,
  openShelf: sharedCopy.openShelf,
  captureATodo: sharedCopy.captureATodo,
  retry: sharedCopy.retry,
  start: sharedCopy.start,
  switcherPlaceholder: sharedCopy.switcherPlaceholder,
  noMatch: sharedCopy.noMatch,
  pasteFailedTheClipboardHoldsAnImageWhich: "Paste failed: The clipboard contains an image instead of text. Save the image, then drop its file on the pane.",
  failed: sharedCopy.failed,
  paste: "Paste",
  clipboardDataUnavailable: "Clipboard data is unavailable.",
  clipboardRetry: "Try again, or copy the content in its source app again.",
  clipboardCopyRetry: "Try again, or select text and use the context menu.",
  copy: sharedCopy.copy,
  daemonExit: (exit: string) => `Disconnected: ${exit}`,
} as const;

import { labels, copy as sharedCopy, type CopyValue } from "../sharedCopy";

export const storageCopy = {
  saveRetry: "Retry saving",
  /** @prose */
  failure: (problems: readonly { key: string; cause: string }[]) => {
    const work = [...new Set(problems.map(problem => labels.get(problem.key.split(":")[1] ?? "") ?? "saved work"))];
    const causes = [...new Set(problems.map(problem => problem.cause))];

    return `Could not save ${work.join(", ")}: ${causes.join("; ")}. Retry saving.`;
  },
  coreFailure_cause: (cause: string, agent: string, address: string) =>
    address === "none" ? `${cause} Agent ${agent}.` : `${cause} Agent ${agent} was on Terminal ${address}.`,
} as const;

export const copy = {
  retrying: sharedCopy.retrying,
  rpcFailure: sharedCopy.rpcFailure,
  captureOff: (cause: string) => `Quick capture could not start. ${cause}`,
  resources: sharedCopy.resources,
  switchProject: sharedCopy.switchProject,
  closeView: sharedCopy.closeView,
  deliverables: sharedCopy.deliverables,
  dismissFailure: sharedCopy.dismissFailure,
  openDraft: sharedCopy.openDraft,
  openEvidence: sharedCopy.openEvidence,
  recoverNotes: sharedCopy.recoverNotes,
  todoDeleteRetry: sharedCopy.todoDeleteRetry,
  quitAndRunJustAppAgainToRebuild: "Quit and run `just app` again to rebuild it.",
  theDaemonIsOlderThanTheApp: (value1: CopyValue) => `This App is newer than the connected version. ${value1}`,
  theDaemonIsNewerThanTheApp: (value1: CopyValue) => `This App is older than the connected version. ${value1}`,
  theAppAndTheDaemonDiffer: (value1: CopyValue) => `The versions differ. ${value1}`,
  theAppAndTheDaemonDiffer2: (value1: CopyValue, value2: CopyValue) => `${value1}: The versions differ. ${value2}`,
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
  dropRetry: "Drop a PNG, JPEG, GIF or WebP image under 20 MiB.",
  clipboardCopyRetry: "Try again, or select text and use the context menu.",
  copy: sharedCopy.copy,
  daemonExit: (exit: string) => `Disconnected: ${exit}`,
  coreFailure_core_missing: "Terminals are not available on this Mac.",
  coreFailure_unsupported_generation: "Terminals need an update before they can start.",
  coreFailure_core_closed: "The Terminal connection was lost.",
  coreFailure_core_silent: "Terminals did not answer.",
  coreFailure_core_error: "The Terminal could not start.",
  coreFailure_core_protocol: "Terminals answered in a way the App cannot read.",
  coreFailure_core_io: "Terminals could not be reached.",
  coreFailure_named: (label: string, agent: string, address: string) =>
    address === "none" ? `${label} Agent ${agent} was affected.` : `${label} Agent ${agent} was on Terminal ${address}.`,
} as const;

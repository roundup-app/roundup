type CopyValue = string | number | undefined;

import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  daemonExit: (exit: string) => `Daemon ${exit}`,
  agentsAndTerminals: "Workstreams and Agents",
  appearHereOnePerRow: "appear here, one per row,",
  nestedByIndent: "nested by indent",
  openAFolderToStart: "Open a folder to start",
  chooseFolder: "Choose folder…",
  todos: shared.todos,
  agentsAddThemAsThey: "Agents add them as they",
  planSoCanYou: "plan; so can you",
  pads: shared.pads,
  agentNotes: " Agent notes",
  yours: " Yours",
  rail: shared.rail,
  centreRegion: "Centre",
  shelfLabel: shared.leaderShortShelf,
  restore: shared.restore,
  maximise: shared.maximise,
  closeShelf: "Close work items",
  close: shared.close,
  reopen: "Reopen",
  clipboardDataUnavailable: "Clipboard data is unavailable.",
  pasteFailedTheClipboardHoldsAnImageWhich: "Paste failed: The clipboard holds an image, which a Terminal cannot take as text. Save it as a file and drop the file on the pane.",
  failed: (value1: CopyValue, value2: CopyValue) => `${value1} failed: ${value2}`,
  paste: "Paste",
  copy: shared.copyDraft,
  clipboardRetry: "Try again, or copy the content in its source app again.",
  clipboardCopyRetry: "Try again, or select the text and copy it with the context menu.",
  quitAndRunJustAppAgainToRebuild: "Quit and run `just app` again to rebuild it.",
  theDaemonIsOlderThanTheApp: (value1: CopyValue) => `The Daemon is older than the App. ${value1}`,
  theAppAndTheDaemonDiffer: (value1: CopyValue) => `The App and the Daemon differ. ${value1}`,
  theDaemonIsNewerThanTheApp: (value1: CopyValue) => `The Daemon is newer than the App. ${value1}`,
  theAppAndTheDaemonDiffer2: (value1: CopyValue, value2: CopyValue) => `${value1}: The App and the Daemon differ. ${value2}`,
} as const;

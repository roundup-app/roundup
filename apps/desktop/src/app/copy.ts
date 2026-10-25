/** App-authored app copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";

export const copy = {

  todos: shared.todos,
  pads: shared.pads,
  close: shared.close,
  maximise: shared.maximise,
  restore: shared.restore,

  rail: shared.rail,
  shelfLabel: shared.leaderShortShelf,
  copy: shared.copyDraft,
  agentsAndTerminals: "Workstreams and Agents",
  /** @prose */
  appearHereOnePerRow: "Each appears below, nested by indent.",
  openAFolderToStart: shared.openAFolderToStart,
  chooseFolder: "Choose Project…",
  /** @prose */
  agentsAddThemAsThey: "Agents add Todos as they plan.",
  /** @prose */
  planSoCanYou: "You can add them too.",
  agentNotes: " Agent notes",
  yours: " Yours",
  reopen: "Reopen",
  /** @prose */
  quitAndRunJustAppAgainToRebuild: "Quit and run `just app` again to rebuild it.",
  /** @prose */
  theDaemonIsOlderThanTheApp: (value1: CopyValue) => `The background service is older than the App. ${value1}`,
  /** @prose */
  theDaemonIsNewerThanTheApp: (value1: CopyValue) => `The background service is newer than the App. ${value1}`,
  /** @prose */
  theAppAndTheDaemonDiffer: (value1: CopyValue) => `The App and background service differ. ${value1}`,
  /** @prose */
  theAppAndTheDaemonDiffer2: (value1: CopyValue, value2: CopyValue) => `${value1}: The App and background service differ. ${value2}`,
  closeShelf: "Close work items",
  /** @prose */
  pasteFailedTheClipboardHoldsAnImageWhich: "The clipboard contains an image. Save it, then drop the file on the Terminal.",
  failed: (value1: CopyValue, value2: CopyValue) => `${value1} failed: ${value2}`,
  paste: "Paste",
  /** @prose */
  clipboardDataUnavailable: "Clipboard data is unavailable.",
  /** @prose */
  clipboardRetry: "Try again, or copy the content in its source app again.",
  /** @prose */
  clipboardCopyRetry: "Try again, or select the text and use its menu.",
  centreRegion: "Centre",
  daemonExit: (exit: string) => `Service ${exit}`,
} as const;

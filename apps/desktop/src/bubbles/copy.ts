/** App-authored bubbles copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

export const copy = {
  dismissFailure: shared.dismissFailure,
  draftIdentity: shared.draftIdentity,
  recoverDrafts: shared.recoverDrafts,
  unfinishedWork: shared.unfinishedWork,
  copyProjectName: shared.copyProjectName,
  currentDraft: shared.currentDraft,
  draftStatus: shared.draftStatus,
  originalUnavailable: shared.originalUnavailable,
  storageRetry: shared.storageRetry,
  discardRevision: shared.discardRevision,
  draftRetention: shared.draftRetention,
  copyDraftFailure: shared.copyDraftFailure,
  minimise: shared.minimise,
  close: shared.close,
  closeQuestion: shared.closeQuestion,
  rename: shared.rename,

  newTerminal: shared.newTerminal,
  closeTerminal: shared.closeProject,
  railDraftConflict: shared.railDraftConflict,
  keep: shared.keep,
  retry: shared.retry,
  unseenMark: shared.unseenMark,
  inspectDraft: "Inspect",
  noDraftRecipient: "No recipient",
  terminalName: shared.terminalName,
  plusTerminal: "+ Terminal",
  terminals: "Terminals",
  /** @prose */
  closeTerminalWarning: "The Terminal and its output will be removed. Its running program will stop.",
  /** @prose */
  closeTerminalOutputWarning: "The Terminal and its output will be removed.",
  closeChord: "⌘K W",
  unseenOutput: "New output",
} as const;

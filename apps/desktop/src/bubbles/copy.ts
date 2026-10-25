type CopyValue = string | number | undefined;

import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  close: shared.close,
  draftRetention: shared.draftRetention,
  storageRetry: shared.storageRetry,
  copyDraftFailure: shared.copyDraftFailure,
  minimise: shared.minimise,
  rename: shared.rename,
  closeChord: "⌘K W",
  unseenOutput: "New output",
  unseenMark: shared.unseenMark,
  terminalName: "Terminal name",
  closeTerminal: (value1: CopyValue) => `Close ${value1}`,
  originalUnavailable: shared.originalUnavailable,
  railDraftConflict: shared.railDraftConflict,
  terminals: "Terminals",
  draftIdentity: shared.draftIdentity,
  recoverDrafts: shared.recoverDrafts,
  newTerminal: shared.newTerminal,
  plusTerminal: "+ Terminal",
  unfinishedWork: shared.unfinishedWork,
  dismissFailure: shared.dismissFailure,
  inspectDraft: "Inspect",
  currentDraft: shared.currentDraft,
  draftStatus: shared.draftStatus,
  noDraftRecipient: "No recipient",
  copyProjectName: shared.copyProjectName,
  discardRevision: shared.discardRevision,
  closeQuestion: shared.closeQuestion,
  closeTerminalWarning: "The Terminal and its output will be removed. Its running program will stop.",
  closeTerminalOutputWarning: "The Terminal and its output will be removed.",
  keep: shared.keep,
  retry: shared.retry,
} as const;

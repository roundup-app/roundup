/** App-authored importer copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";

const importExcludedReasons = new Map<string, string>([
  ["alreadyImported", "It was already imported"],
  ["ambiguousProject", "It uses several directories in this Project"],
  ["missingDirectory", "Its directory is no longer there"],
  ["insideWorktree", "It is in a Worktree"],
  ["duplicateSource", "It is already listed"],
  ["unknownActivity", "No usable time was recorded"],
  ["noDirectory", "No working directory was recorded"],
  ["tooManyDirectories", "Too many working directories were recorded"],
  ["noCompleteRecords", "It has no complete conversation records"],
  ["unsupportedSource", "The saved conversation filename is not a UUID"],
  ["previewLimit", "The conversation exceeds the preview size limit"],
  ["recordLimit", "A conversation record exceeds the size limit"],
  ["snapshotLimit", "The conversation exceeds the import size limit"],
  ["malformedRecord", "The conversation records could not be read"],
  ["subagentRecord", "It belongs to another conversation"],
  ["foreignIdentity", "The saved identity does not match this conversation"],
  ["metadataLimit", "The conversation details exceed the size limit"],
  ["incompleteMetadata", "The conversation details could not be fully read"],
  ["sdkUnreadable", "It could not be opened by the conversation reader"],
  ["recordsMissing", "The saved conversation records are missing"],
  ["insideRoundup", "It is in roundup's own directory"],
  ["liveWithoutRecords", "The running conversation has no saved records yet"],
]);

const importRefusals = new Map<number, string>([
  [-32700, "The import request could not be read."],
  [-32601, "It is not possible to import conversations in this version."],
  [-32602, "The import choices were not accepted."],
  [-32001, "The conversation is no longer available."],
  [-32002, "Import is not allowed here."],
  [-32003, "The saved conversation changed or no longer matches this preview."],
  [-32005, "The conversation is busy."],
  [-32007, "The conversation is no longer running."],
  [-32009, "The import preview is out of date."],
  [-32010, "The conversation inbox is unavailable."],
]);

export const copy = {
  retryStorage: shared.retryStorage,

  copyDraftFailure: shared.copyDraftFailure,
  cancel: shared.cancel,
  importRefresh: shared.importRefresh,
  importUnnamed: shared.importUnnamed,
  copy: shared.copyDraft,
  importTitle: "Import work",
  importPeriod: "Period",
  importPeriodName: (value1: "day" | "week" | "month") => `Last ${value1}`,
  importLooking: "Looking for conversations…",
  /** @prose */
  importNone: "No conversations were found in this period.",
  importResults: "Conversations",
  importConfirm: (value1: CopyValue) => value1 === 0 ? "Import" : `Import ${value1}`,
  importChoices: "Saved Import choices",
  importConflict: "Import choices conflict",
  /** @prose */
  importConflictExplanation: "Import choices have changed in another window. Both versions stay here. Open either version to review it. Discard only the version you no longer need.",
  importChoice: (number: number) => `Import choices ${number}`,
  importOpenChoice: (number: number) => `Open choices ${number}`,
  importDiscardChoice: (number: number) => `Discard choices ${number}`,
  /** @prose */
  importRestoreFailure: "Import choices could not be restored. Saved choices will be kept until storage recovers.",
  /** @prose */
  importRetentionFailure: "Import choices could not be saved for reload.",
  /** @prose */
  importRetentionRecovery: "Keep this window open; your choices are still here.",
  /** @prose */
  importRestored: (count: number) => `${count} were chosen earlier. Refresh to check they are unchanged.`,
  importNotImportable: (count: number) => `${count} not importable`,
  /** @prose */
  importExcludedReason: (cause: string) => `${importExcludedReasons.get(cause) ?? "It could not be read as a conversation"}.${["missingDirectory", "noCompleteRecords", "incompleteMetadata", "sdkUnreadable", "recordsMissing", "liveWithoutRecords", "unknown"].includes(cause) ? " Refresh to check again." : ""}`,
  importAge: (minutes: number) => minutes < 1440 ? shared.riskTime(minutes) : `${Math.floor(minutes / 1440)} d ago`,
  /** @prose */
  importUnconfirmed: "Import completion is unconfirmed. Keep your choices; Refresh to check before importing again.",
  /** @prose */
  importRowRefusal: (failure: { code: number; outcome: string }) => failure.outcome === "failed" && importRefusals.has(failure.code)
    ? `${importRefusals.get(failure.code)} ${[-32001, -32007, -32003, -32009].includes(failure.code) ? "Refresh to check available conversations." : "Choose it again, or Refresh."}`
    : null,
  importLocation: (cwd: string, project: string) => cwd === "" ? project : cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? project,
} as const;

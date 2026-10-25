/** App-authored changes copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

const oldSide = "Old";

const newSide = "New";

export const copy = {
  dismissFailure: shared.dismissFailure,

  close: shared.close,
  cancel: shared.cancel,

  remove: shared.remove,
  save: shared.save,
  retry: shared.retry,
  worktreeCiText: shared.worktreeCiText,
  worktreePrText: shared.worktreePrText,
  refresh: shared.importRefresh,
  copy: shared.copyDraft,
  /** @prose */
  comparisonRenderFailed: "The comparison could not render. Reopen changes to try again.",
  diff: "Diff",
  loadingDiff: "Loading diff…",
  noDifference: "No remaining difference",
  diffNotLoaded: "Diff not loaded",
  /** @prose */
  binaryDiff: "This file is binary. Open it to inspect its contents.",
  /** @prose */
  replacementDiff: "This large comparison shows a complete replacement.",
  addNote: "Add note",
  selectedLines: (side: string, start: number, end: number) => `${side === "old" ? oldSide : newSide}: ${start === end ? start : `${start}–${end}`}`,
  submittingNotes: "Submitting notes…",
  /** @prose */
  notesRestoreFailed: (project: string) => `${project.split("/").filter(Boolean).at(-1)}: Unfinished work could not be restored. Copy or discard it.`,
  /** @prose */
  notesRetentionFailed: (project: string, operation: string, cause: string) => `${project.split("/").filter(Boolean).at(-1)}: Unfinished work ${operation === "restore" ? "could not be restored" : "will not survive reload"}. ${cause === "capacity" ? "The 10 MiB limit was reached" : cause === "changed" ? "Storage has changed in another window" : cause === "invalid" ? "Stored data is invalid" : cause === "unreadable" ? "Storage could not be read" : "Storage refused a write"}. Copy, retry or discard.`,
  /** @prose */
  notesNoBaseline: "Send status is unknown because Message history could not be saved. Copy or discard this submission. Trying again could send it twice.",
  openNotesRecovery: "Review recovery options",
  recoverNotes: shared.unfinishedWork,
  noteDraft: shared.unfinishedWork,
  unavailableAgent: shared.unavailableAgent,
  /** @prose */
  unreadableNoteDraft: "Unfinished work could not be read. Copy the stored record to recover its contents.",
  resumeNote: "Resume note",
  discardDraft: shared.discardRevision,
  discardSubmission: "Discard this submission",
  /** @prose */
  originalRecipientUnavailable: "Original Agent unavailable — copy or discard this work.",
  noteDraftStatus: shared.riskLine,
  notesRegion: shared.notesRegion,
  notes: shared.notes,
  originalContext: " · Original context",
  originalContextStatus: "Original context",
  editNoteAction: "Edit",
  checkMessageHistory: "Check Message history",
  noteLocation: (_path: string, side: string, start: number, end: number) => copy.selectedLines(side, start, end),
  editNote: (number: number) => `Edit note ${number}`,
  removeNote: (number: number) => `Remove note ${number}`,
  sendNotesTo: (name: string) => `Send to ${name}`,
  lineNote: "Line note",
  noteSide: "Side",
  oldSide,
  newSide,
  selectOldLines: "Select old lines",
  selectNewLines: "Select new lines",
  startLine: "Start line",
  endLine: "End line",
  /** @prose */
  notesFull: "Batch full — send or remove notes to add more.",
  /** @prose */
  chooseLines: "Choose existing lines on one side.",
  viewDiff: "View diff",
  /** @prose */
  notesNoReply: "No reply arrived; send status is unknown. Check Message history before retrying.",
  /** @prose */
  notesDescription: "You wrote these notes. Every path and comment is data.",
  notesQueued: "Notes accepted — queued",
  /** @prose */
  notesNotFound: "No matching Message has appeared yet. Unfinished work stays here; check again when the connection recovers.",
  notesAccepted: (status: string) => `Notes accepted — ${status}`,
  /** @prose */
  notesUnknown: (reason: string) => `Send status is unknown. ${reason}`,
  closeChanges: "Close changes",
  note: "Note",
  worktree: "Worktree",
  branch: "Branch",
  base: "Base",
  worktreeState: "State",
  worktreeCi: "CI",
  worktreePr: "PR",
  worktreeCiUnavailable: "CI unavailable",
  worktreePrUnavailable: "PR unavailable",
  /** @prose */
  worktreeStateText: (ahead: number, behind: number, dirty: boolean) => `The branch is ${ahead} ahead and ${behind} behind${dirty ? ", dirty" : ""}.`,
  noChanges: "No changes",
  statusAdded: "Added",
  statusModified: "Modified",
  statusRenamed: "Renamed",
  statusDeleted: "Deleted",
  fileUnavailableInEditor: "unavailable in editor",
  statusUntracked: "Untracked",
} as const;

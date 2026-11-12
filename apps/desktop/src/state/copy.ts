import { copy as sharedCopy } from "../sharedCopy";

export const storageCopy = {
  incompatible: sharedCopy.storageIncompatible,
  restoreFailure: (cause: string) => `Could not restore saved work: ${cause}.`,
  readFailure: (cause: string) => `Could not read saved work: ${cause}.`,
  notRestored: "Saved work is still restoring.",
  replaced: "Saving was interrupted. Retry saving your work.",
  changed: "Saved work was changed. Review it before retrying.",
} as const;

const pluralSuffix = (count: number) => count === 1 ? "" : "s";

export const copy = {
  resumeNote: "Your last turn was cut off by a Claude service error. Please continue where you left off.",
  actionsUnregistered: "The App could not register its actions.",
  projectNoLongerOpen: "Project is closed.",
  terminalOutcomeUnknown: sharedCopy.terminalOutcomeUnknown,
  renameDidNotApply: (asked: string, kept: string) => `Rename to ${asked} did not apply; ${kept} was kept. Rename again.`,
  moveDidNotApply: "The move did not apply; the row stayed where it was. Move it again.",
  keep: sharedCopy.keep,
  newWorkstreamTitle: sharedCopy.newWorkstreamTitle,
  worktreeReadUnavailable: sharedCopy.worktreeReadUnavailable,
  theDoorDidNotStartInTimeRetry: "It did not start in time. Retry.",
  askNoAcknowledgement: "not found yet",
  importDefaultPrompt: "Find active and recent Claude Code conversations in this Project",
  importAgentName: sharedCopy.importAgentName,
  importTimeout: "Looking for conversations took too long. Retry to try again, or choose a shorter period.",
  importUnnamed: sharedCopy.importUnnamed,
  workstreamName: sharedCopy.workstream,
  deleteBusy: "Another delete is still finishing. Try again in a moment.",
  deleting: (ids: string) => `Deleting ${ids}`,
  deleteNotConnected: "The project is not connected yet. Try again in a moment.",
  deleteBlockedBy: (name: string) => `${name} is unconfirmed. Press Check deletion to check it, or Dismiss to leave it.`,
  deleteStaysUnconfirmed: (name: string) => `${name} is still unconfirmed.`,
  todoUndo: sharedCopy.todoUndo,
  redo: sharedCopy.redo,
  undoAction: (action: string) => `Undo ${action}`,
  redoAction: (action: string) => `Redo ${action}`,
  deleteAction: (count: number, noun: "Todo" | "Pad") => `Delete ${noun}${pluralSuffix(count)}`,
  todoDeleteMissing: "The chosen Todo is no longer available. Retry to check again.",
  todoRestoreUnknown: "Restoration is unconfirmed. Try Undo again.",
  remove: sharedCopy.remove,
  todo: sharedCopy.todo,
  pad: sharedCopy.pad,
} as const;

/** App-authored rail copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";
import type { WorktreeCiState } from "@contracts/agent/WorktreeCiState";

const task = "Work";

const railDraftLabels = new Map([["rail-task", task], ["rail-name", shared.name], ["rail-clear", "Clear reason"]]);

const railDraftStatuses = new Map([["draft", shared.draftStatus.draft], ["pending", "Submitting…"], ["unknown", "Completion unconfirmed"], ["failed", "Not submitted"]]);

export const copy = {
  draftStatus: shared.draftStatus,
  riskLine: shared.riskLine,

  storageRetry: shared.storageRetry,

  draftRetention: shared.draftRetention,
  moveUp: shared.moveUp,
  moveDown: shared.moveDown,
  todos: shared.todos,
  pads: shared.pads,
  running: shared.running,
  close: shared.close,
  rename: shared.rename,
  remove: shared.remove,
  railDraftConflict: shared.railDraftConflict,
  railDraftDiscard: shared.discardRevision,
  delete: shared.delete,
  keep: shared.keep,
  startNow: shared.startNow,
  workstreams: shared.workstreams,
  overview: shared.overview,
  rail: shared.rail,
  doneCount: shared.doneCount,
  clearName: shared.clearName,
  importUnnamed: shared.importUnnamed,
  name: shared.name,
  stop: shared.stop,
  worktreeCiText: shared.worktreeCiText,
  worktreePrText: shared.worktreePrText,
  worktreeUnavailableMark: shared.measurementUnknown,
  toastLine: shared.toastLine,
  complete: shared.complete,
  resume: shared.resume,
  agentNoun: shared.settingsAgents,
  comma: shared.comma,
  counted: shared.counted,
  unseenMark: shared.unseenMark,
  unreadResult: shared.unreadResult,
  /** @prose */
  importTimeout: "Looking for conversations took too long. Refresh to try again, or choose a shorter period.",
  railDraftTaskTarget: (name: string) => `Work for ${name}`,
  railDraftTaskAction: (send: boolean) => send ? "Send to supervisor" : "Start Agent",
  /** @prose */
  railDraftUnknown: (project: string) => `A submission in ${project} may have completed. Unfinished work stays here; reopening does not retry it. Review the target before creating another request.`,
  railDraftBase: (name: string) => `Original name: ${name}`,
  railDraftDestination: shared.riskLine,
  railDrafts: shared.unfinishedWork,
  /** @prose */
  railDraftUnavailable: "The original target is unavailable. Copy or discard your unfinished work.",
  /** @prose */
  railDraftRetention: (project: string, surface: string, operation: "restore" | "retain") => `${railDraftLabels.get(surface) ?? shared.unfinishedWork} in ${project}: ${operation === "restore" ? "stored work could not be restored" : "work could not be saved for reload"}. Keep this window open; copy your work or retry storage.`,
  railDraftRetry: "Retry storage",
  /** @prose */
  railDraftRecovery: (surface: string, object: string, status: string) => `Unfinished work for ${object} (${railDraftLabels.get(surface) ?? shared.rail}) is ${railDraftStatuses.get(status) ?? "Unconfirmed"}.`,
  railDraftMissingTarget: "Unavailable target",
  railDraftRecovered: shared.unfinishedWork,
  railDraftCopy: shared.copyDraft,
  task,
  /** @prose */
  taskHint: "What should the Agent do?",
  queuedBadge: (place: number) => `queued · ${place}`,
  afterBadge: (id: number) => `after #${id}`,
  takeOutOfQueue: "Leave queue",
  projectSettings: "Project settings",
  runAtMost: "Run at most",
  workstreamsAtOnce: "Workstreams at once",
  noLimit: "No limit",
  /** @prose */
  capRefusal: "Choose a whole number greater than zero.",
  overviewLabel: shared.needYou,
  workstreamsHead: "WORKSTREAMS",
  askingTheDoor: "Asking the supervisor…",
  addWorkstream: "Add Workstream",
  addWorkstreamWord: " Workstream",
  collapse: "Collapse",
  retryDoor: "Retry supervisor",
  startDoor: "Start supervisor",
  agents: (value1: CopyValue) => `${value1} agents`,
  rowActions: "Row actions",
  addAgentLabel: "Add Agent",
  clearWorkstream: "Clear Workstream…",
  openFolder: shared.openAFolderToStart,
  openInEditor: "Open in editor",
  startingDoor: "Starting supervisor…",
  doorDidNotStart: "Supervisor start failed",
  doorNotStarted: "Supervisor not started",
  doorStopped: "Supervisor stopped",
  doorStoppedWithExit: (value1: CopyValue) => `Supervisor stopped, ${value1}`,
  worktreeCiChip: (state: WorktreeCiState) => ({ passed: "✓ CI", failed: "✗ CI", running: "… CI", "no-ci": "— CI", conflicts: "! CI", error: "⚠ CI", unknown: "? CI" }[state]),
  worktreeStale: shared.worktreeStale,
  worktreePrState: (number: number, stale: boolean) => `PR #${number}${stale ? shared.worktreeStale : ""}`,
  worktreeUnavailable: "Worktree state unavailable",
  worktreeAhead: (ahead: number) => `${ahead.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })}↑`,
  worktreeAheadState: (ahead: number) => `${ahead.toLocaleString("en-US")} ahead`,
  renameChord: "F2",
  restart: "Restart",
  startYolo: "Start YOLO",
  whyClear: "Why clear?",
  /** @prose */
  theDoorIsWritingTheHandoff: "The supervisor is writing the summary.",
  /** @prose */
  theDoorWritesAHandoffKeepsWhatYou: (value1: CopyValue) => `The supervisor writes a summary and keeps your request. It archives other work and stops ${value1} ${value1 === 1 ? "Subagent" : "Subagents"}. Their files stay.`,
  clearWithHandoff: "Clear with summary",
  clearWithoutHandoff: "Clear without summary",
  clearMenu: "Clear…",
  /** @prose */
  resumeOutcomeUnknownTheDaemonMayHaveResumed: "Resume is unconfirmed. Check the Agent before trying again.",
  unlandedWorkAhead: (value1: CopyValue) => `${value1} ahead`,
  unlandedWorkUncommittedChanges: "Uncommitted changes",
  goes: (value1: CopyValue) => `Goes: ${value1}`,
  openTodoNoun: "open Todos",
  /** @prose */
  staysAtTheProjectRoot: (value1: CopyValue) => `${value1} stays at the Project root.`,
  moreAgents: (value1: CopyValue) => `+ ${value1} more`,
  padCount: (value1: CopyValue) => `${value1} Pads`,
  todoCount: (value1: CopyValue) => `${value1} Todos`,
  padsAndTodos: (value1: CopyValue) => `${value1} work items`,
  doneTodos: "done Todos",
  nothing: "Nothing",
  needYou: shared.needYou,
  stopQuestion: (name: string) => `Stop ${name}?`,
  stopAndRemoveQuestion: (name: string) => `Stop/remove ${name}?`,
  removeQuestion: (name: string) => `Remove ${name}?`,
} as const;

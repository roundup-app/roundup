/** App-authored shared copy (U471). Supplied values remain unchanged. */
import type { WorktreeCiState } from "@contracts/agent/WorktreeCiState";

const terminalName = "Terminal name";

const notesRegion = "Agent notes";

const notes = "Notes";

const projectName = "Project name";

const triageWorkstream = "Workstream";

const orderLimits = "Limits";

const text = "Text";

const openAFolderToStart = "Open Project";

const unavailableAgent = "Unavailable Agent";

const settingsTerminal = "Terminal";

const measurementTools = "Tools";

const measurementOther = "Other";

const timelineUnknown = "Unknown";

const triage = "Triage";

const settings = "Settings";

const settingsAgents = "Agents";

const permissionAuto = "Auto";

const timeline = "Timeline";

const timelineNow = "now";

const measurementUnknown = "—";

const measurementTime = "Time";

const dismissFailure = "Dismiss";

const retryStorage = "Try again";

const queryCopied = "Copied";

const recoverDrafts = "Recover unfinished work";

const openDraft = "Open";

const copyDraft = "Copy";

const unfinishedWork = "Unfinished work";

const copyProjectName = "Copy name";

const currentDraft = "Current work";

const originalUnavailable = "Original object unavailable";

const storageRetry = "Retry storage only";

const discardRevision = "Discard";

const moveUp = "Move up";

const moveDown = "Move down";

const todos = "Todos";

const pads = "Pads";

const running = "Running";

const minimise = "Minimise";

const close = "Close";

const cancel = "Back";

const importRefresh = "Refresh";

const rename = "Rename";

const error = "Error";

const needsYou = "Needs you";

const blocked = "Blocked";

const idle = "Idle";

const done = "Done";

const maximise = "Maximise";

const restore = "Restore";

const newAgent = "New Agent";

const newTerminal = "New Terminal";

const remove = "Remove";

const leaderShortShelf = "Work items";

const leaderShortCapture = "Capture";

const captureATodo = "Capture a Todo";

const leaderShortInbox = "Inbox";

const title = "Title";

const ask = "Ask";

const save = "Save";

const copyFailed = "Copy failed";

const railDraftConflict = "The original name has changed. Copy or discard your unfinished work.";

const exportMd = "Export .md";

const deleteLabel = "Delete";

const keep = "Keep";

const pad = "Pad";

const ownedBy = "Owned by ";

const retry = "Retry";

const projectRoot = "Project root";

const unassigned = "Unassigned";

const newWorkstreamTitle = "New Workstream";

const startNow = "Start now";

const workstreams = "Workstreams";

const assign = "Assign";

const overview = "Overview";

const rail = "Rail";

const doneCount = " done";

const importUnnamed = "Unavailable conversation title";

const unavailableHome = "Unavailable Workstream";

const name = "Name";

const clear = "Clear";

const stop = "Stop";

const questionMark = "?";

const toolCallFailed = "Failed";

const askBarShortcut = "Ask bar";

const noMatch = "No match";

const move = "Move";

const blocks = "Blocks";

const me = "Me";

const comment = "Comment";

const complete = "Complete";

const todo = "Todo";

const resume = "Resume";

const comma = ", ";

const unseenMark = "●";

const unreadResult = "Unread result";

const worktreeStale = ", stale";

export type CopyValue = string | number | undefined;

export const draftProblem = (cause: string) => `${cause === "write" ? "Unfinished work could not be saved for reload." : cause === "capacity" ? "Storage for unfinished work is full." : cause === "changed" ? "Stored unfinished work has changed in another window." : cause === "unreadable" ? "Could not read stored unfinished work." : "The cause is unknown; unfinished work could not be restored."} Stored data stays safe. Try storage again.`;

export const draftSurfaceLabels = new Map(Object.entries({ rail: "Project item", agent: "Agent", workstream: triageWorkstream, terminal: settingsTerminal, orders: "Order", pads: pad, todos: todo, thread: "Thread", brief: "Brief", notes: notes, steer: "Steer", ask: ask, header: projectName, bubbles: terminalName, changes: notesRegion, terminal_selection: "Terminal selection", queries: "Search", reactions: "Reaction" }));

export const copy = {
  askDropped: "Dropped",
  worktreeStale,
  riskLine: (cause: CopyValue, time: CopyValue) => `${cause} · ${time}`,
  needYou: (count: CopyValue) => `${count} need you`,



  terminalName: terminalName,
  notesRegion: notesRegion,
  notes: notes,
  projectName: projectName,
  triageWorkstream: triageWorkstream,
  orderLimits: orderLimits,
  text: text,
  openAFolderToStart: openAFolderToStart,

  unavailableAgent: unavailableAgent,
  settingsTerminal: settingsTerminal,
  measurementTools: measurementTools,
  measurementOther: measurementOther,
  timelineUnknown: timelineUnknown,
  triage: triage,
  riskTime: (minutes: number) => minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`,
  settings: settings,
  settingsAgents: settingsAgents,
  permissionAuto: permissionAuto,
  timeline: timeline,
  timelineNow: timelineNow,
  measurementUnknown: measurementUnknown,
  measurementTime: measurementTime,
  /** @prose */
  deliverableUnavailable: {
    "missing-revision": "The published copy is missing. Restore it before opening again.",
    "integrity-failure": "The published copy failed its integrity check. Restore an intact copy.",
    "access-revoked": "Access was revoked or the source was removed. Check its permissions.",
    "source-unknown": "Source access could not be verified. Try opening it again.",
    "materialization-failed": "The published copy could not be opened. Try opening it again.",
  },
  dismissFailure: dismissFailure,
  retryStorage: retryStorage,
  queryCopied: queryCopied,
  draftSurface: (surface: string) => draftSurfaceLabels.get(surface) ?? unfinishedWork,
  draftField: (field: string) => ({ originalName: "Original name", document: "Editor document", editorSource: "Original editor source", editorCaret: "Editor selection context", source: "Source", base: "Original source", name: name, title: title, ask: ask, done: done, password: "Password", body: text, text: text, content: text, limits: orderLimits })[field] ?? "Stored value",
  draftIdentity: (...parts: string[]) => parts.join(" · "),
  recoverDrafts: recoverDrafts,
  openDraft: openDraft,
  copyDraft: copyDraft,
  unfinishedWork: unfinishedWork,
  copyProjectName: copyProjectName,
  currentDraft: currentDraft,
  draftStatus: { draft: "Unsubmitted", pending: "Pending", failed: toolCallFailed, unknown: "Send unconfirmed" },
  originalUnavailable: originalUnavailable,
  storageRetry: storageRetry,
  discardRevision: discardRevision,
  /** @prose */
  draftRetention: (project: string, surface: string, cause: string) => `${project} · ${surface}: ${draftProblem(cause)}`,
  copyField: (field: string) => `Copy ${field}`,
  /** @prose */
  copyDraftFailure: (reason: string) => `Copy failed: ${reason}. Select the text to copy it.`,
  openEvidence: (value1: CopyValue) => `Open ${value1}`,
  moveUp: moveUp,
  moveDown: moveDown,
  todos: todos,
  pads: pads,
  running: running,
  minimise: minimise,
  close: close,
  closeQuestion: (value1: CopyValue) => `Close ${value1}?`,
  cancel: cancel,
  importRefresh: importRefresh,
  rename: rename,
  closeProject: (value1: CopyValue) => `Close ${value1}`,
  error: error,
  needsYou: needsYou,
  blocked: blocked,
  idle: idle,
  done: done,
  maximise: maximise,
  restore: restore,
  newAgent: newAgent,
  newTerminal: newTerminal,
  remove: remove,
  leaderShortShelf: leaderShortShelf,
  leaderShortCapture: leaderShortCapture,
  captureATodo: captureATodo,
  leaderShortInbox: leaderShortInbox,
  title: title,
  ask: ask,
  save: save,
  copyFailed: copyFailed,
  /** @prose */
  railDraftConflict: railDraftConflict,
  exportMd: exportMd,
  delete: deleteLabel,
  keep: keep,
  pad: pad,
  ownedBy: ownedBy,
  retry: retry,
  projectRoot: projectRoot,
  unassigned: unassigned,
  newWorkstreamTitle: newWorkstreamTitle,
  startNow: startNow,
  workstreams: workstreams,
  assign: assign,
  addTodoTo: (group: CopyValue) => `Add Todo: ${group}`,
  overview: overview,
  rail: rail,
  doneCount: doneCount,
  clearName: (value1: CopyValue) => `Clear ${value1}`,
  importUnnamed: importUnnamed,
  unavailableHome: unavailableHome,
  name: name,
  clear: clear,
  stop: stop,
  worktreeCiText: (state: WorktreeCiState, stale: boolean, label = false) => {
    const value = { passed: "Passed", failed: toolCallFailed, running: running, "no-ci": "None", conflicts: "Conflicts", error: error, unknown: timelineUnknown }[state];

    return `${label && state !== "no-ci" ? `CI ${value.toLowerCase()}` : value}${stale ? worktreeStale : ""}`;
  },
  worktreePrText: (number: number, stale: boolean) => `#${number}${stale ? worktreeStale : ""}`,
  questionMark: questionMark,
  toolCallFailed: toolCallFailed,
  reactionWhen: (at: string) => new Date(at).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  askBarShortcut: askBarShortcut,
  noMatch: noMatch,
  linkUrl: (kind: string, id: string, project: string) => `roundup://${kind}/${id}?project=${project}`,
  linkNote: (link: string) => `${link}\nrup link read ${link}`,
  toastLine: (value1: CopyValue, value2: CopyValue) => `${value1}: ${value2}`,
  changedTodo: (value1: CopyValue) => `Changed Todo "${value1}"`,
  move: move,
  blocks: blocks,
  me: me,
  comment: comment,
  complete: complete,
  todo: todo,
  resume: resume,
  comma: comma,
  percent: (value: number) => `${value}%`,
  counted: (value: string | number, noun: string) => `${value} ${noun}`,
  unseenMark: unseenMark,
  unreadResult: unreadResult,
} as const;

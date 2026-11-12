import { labels, copy as sharedCopy, type CopyValue } from "../sharedCopy";

export const linkCopy = {
  /** @prose */
  notOpened: (url: string, cause: string) => `link not opened: ${url}: ${cause}`,
  /** The digest the Daemon hashes a Project path with; not shown. */
  keyDigest: "SHA-256",
  /** @prose */
  noOwner: "no running Project owns it",
  closed: (project: string) => `${project} is not open.`,
  openProject: sharedCopy.openEvidence,
} as const;

export const storageCopy = {
  incompatible: sharedCopy.storageIncompatible,
  restoring: "Restoring saved work…",
  restoreRetry: sharedCopy.retry,
  deleteSaved: "Delete saved data",
  saveRetry: "Retry saving",
  /** @prose */
  failure: (problems: readonly { key: string; cause: string }[]) => {
    const work = [...new Set(problems.map(problem => labels.get(problem.key.split(":")[1] ?? "") ?? "saved work"))];
    const causes = [...new Set(problems.map(problem => problem.cause))];

    return `Could not save ${work.join(", ")}: ${causes.join("; ")}. Retry saving.`;
  },
} as const;

const openProjectRetry = "Use Open Project to try again.";

export const copy = {
  captureOff: (cause: string) => `Quick capture could not start. ${cause}`,
  projectMenuLabel: (name: string, fallback: string) => name === "agent.new-with-prompt" ? "New Agent with a Prompt…" : name === "attention.jump" ? "Jump to What Needs You" : name === "leader.changes" ? "Review Changes" : name === "project.choose-folder" ? "Open Folder…" : fallback,
  openProjectRetry,
  openProjectFailed: "Opening failed",
  /** @prose */
  openProjectRecovery: (path: string, cause: string) => `${path}: ${cause} ${openProjectRetry}`,
  openUser: sharedCopy.you,
  openProjectTitle: "Open Project?",
  openProjectChoice: sharedCopy.openDraft,
  refuseProject: "Refuse",
  /** @prose */
  openProjectQuestion: (agent: string, source: string) => `${agent} in ${source} asks to open`,
  openRefused: (path: string) => `The user refused to open ${path}. Ask the user before trying again.`,
  openConnectionLost: (path: string) => `The App connection was lost while opening ${path}. Check open Projects before retrying.`,
  claudeBinary: (version: string, path: string) => `claude ${version}  ${path}`,
  recentFolders: "Recent Projects",
  claudeNotFound: "Claude Code is unavailable. Install Claude Code and try again.",
  resources: sharedCopy.resources,
  switchProject: sharedCopy.switchProject,
  closeView: sharedCopy.closeView,
  rpcFailure: sharedCopy.rpcFailure,
  deliverables: sharedCopy.deliverables,
  dismissFailure: sharedCopy.dismissFailure,
  openDraft: sharedCopy.openDraft,
  openEvidence: sharedCopy.openEvidence,
  loadingProject: "Loading Project…",
  recoverNotes: sharedCopy.recoverNotes,
  todoUndo: sharedCopy.todoUndo,
  redo: sharedCopy.redo,
  todoDeleteRetry: sharedCopy.todoDeleteRetry,
  openAFolderToStart: "Choose a Project",
  chooseFolder: sharedCopy.chooseFolder,
  emptyRailTitle: "No Agents yet",
  emptyRailLine: "Start a Workstream or an Agent.",
  emptyTodosLine: sharedCopy.emptyTodosLine,
  emptyPadsLine: sharedCopy.emptyPadsLine,
  todos: sharedCopy.todos,
  pads: sharedCopy.pads,
  reopen: sharedCopy.reopen,
  quitAndRunJustAppAgainToRebuild: "Quit and run `just app` again to rebuild it.",
  theDaemonIsOlderThanTheApp: (value1: CopyValue) => `This App is newer than the connected version. ${value1}`,
  theDaemonIsNewerThanTheApp: (value1: CopyValue) => `This App is older than the connected version. ${value1}`,
  theAppAndTheDaemonDiffer: (value1: CopyValue) => `The versions differ. ${value1}`,
  theAppAndTheDaemonDiffer2: (value1: CopyValue, value2: CopyValue) => `${value1}: The versions differ. ${value2}`,
  /** @prose */
  projectStartRecovery: (name: string, stage: string, cause: string) => `${name}: ${stage} failed: ${cause}. Inspect it before retrying.`,
  projectStartStage: "start",
  /** @prose */
  projectStartFailed: (path: string, id: string, stage: string, cause: string) => `${path}: row ${id} was created; ${stage} failed: ${cause}. Inspect it before retrying.`,
  close: sharedCopy.close,
  closeShelf: sharedCopy.closeShelf,
  maximise: sharedCopy.maximise,
  restore: sharedCopy.restore,
  newAgent: sharedCopy.newAgent,
  captureATodo: sharedCopy.captureATodo,
  retry: sharedCopy.retry,
  start: sharedCopy.start,
  newWorkstreamTitle: sharedCopy.newWorkstreamTitle,
  rail: sharedCopy.rail,
  shelfLabel: sharedCopy.shelfLabel,
  switcherPlaceholder: sharedCopy.switcherPlaceholder,
  noMatch: sharedCopy.noMatch,
  pasteFailedTheClipboardHoldsAnImageWhich: "Paste failed: The clipboard contains an image instead of text. Save the image, then drop its file on the pane.",
  failed: sharedCopy.failed,
  paste: "Paste",
  clipboardDataUnavailable: "Clipboard data is unavailable.",
  clipboardRetry: "Try again, or copy the content in its source app again.",
  clipboardCopyRetry: "Try again, or select text and use the context menu.",
  copy: sharedCopy.copy,
  centreRegion: "Centre",
  daemonExit: (exit: string) => `Disconnected: ${exit}`,
} as const;

export const menuBarCopy = {
  waiting: "Waiting",
  ready: "Ready",
  empty: "Nothing for you",
  open: "Open roundup",
  more: (count: number) => `${count} more…`,
  earlier: (count: number) => `${count} earlier…`,
  /** @prose */
  subtitle: (live: string, project: string | null) => (project === null ? live : sharedCopy.dotted(live, project)),
};

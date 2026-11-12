import { copy as sharedCopy } from "../sharedCopy";

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
} as const;

const openProjectRetry = "Use Open Project to try again.";

export const copy = {
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
  todoUndo: sharedCopy.todoUndo,
  redo: sharedCopy.redo,
  openAFolderToStart: "Choose a Project",
  chooseFolder: sharedCopy.chooseFolder,
  emptyTodosLine: sharedCopy.emptyTodosLine,
  emptyPadsLine: sharedCopy.emptyPadsLine,
  todos: sharedCopy.todos,
  pads: sharedCopy.pads,
  reopen: sharedCopy.reopen,
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
  newWorkstreamTitle: sharedCopy.newWorkstreamTitle,
  rail: sharedCopy.rail,
  shelfLabel: sharedCopy.shelfLabel,
  centreRegion: "Centre",
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

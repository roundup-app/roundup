import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  starting: sharedCopy.starting,
  runPrinted: (command: string) => `Run ${command}`,
  terminalFocusChanged: "Terminal focus changed",
  terminalDestinationUnavailable: "Terminal could not open: its font or layout was not ready.",
  terminalPreparationUnavailable: "Terminal could not open: its renderer was not available.",
  terminalPreparationCancelled: sharedCopy.terminalPreparationCancelled,
  dismissFailure: sharedCopy.dismissFailure,
  error: sharedCopy.error,
  needsYou: sharedCopy.needsYou,
  blocked: sharedCopy.blocked,
  working: sharedCopy.working,
  idle: sharedCopy.idle,
  done: sharedCopy.done,
  tabWithStatus: sharedCopy.named,
  newAgent: sharedCopy.newAgent,
  noSelectionTitle: "Nothing selected",
  noSelectionLine: "Pick an Agent in the Rail, or start one.",
  ask: sharedCopy.askBarLabel,
  emptyOutputLine: "Output from this Agent appears here while it runs.",
  newTerminal: sharedCopy.newTerminal,
  retry: sharedCopy.retry,
  start: sharedCopy.start,
  addWorkstreamWord: sharedCopy.addWorkstreamWord,
  startingDoor: sharedCopy.startingDoor,
  doorDidNotStart: sharedCopy.doorDidNotStart,
  doorNotStarted: sharedCopy.doorNotStarted,
  doorStopped: sharedCopy.doorStopped,
  doorStoppedWithExit: sharedCopy.doorStoppedWithExit,
  askBarLabel: sharedCopy.askBarLabel,
  askBarShortcut: sharedCopy.askBarShortcut,
  selectCommand: "Select command",
  /** U7191i: the stopped Agent's saved conversation id, shortened; the full id is the tooltip and what Copy writes. */
  conversationBar: "Saved conversation",
  conversationId: (id: string) => `Conversation ${id.slice(0, 8)}…`,
  copy: sharedCopy.copy,
  copied: sharedCopy.copied,
  fork: "Fork",
  forking: "Forking…",
  restart: sharedCopy.restart,
  restarting: sharedCopy.restarting,
  noOutputKeptFromAnEarlierRun: "No output kept from an earlier run.",
  /** The first line is the failure; the cause follows it for the tooltip. */
  terminalRestoreFailed: (cause: string) => `Could not restore Terminal output.\n${cause}`,
  openFailed: (target: string) => `Opening ${target} failed.\nClick the link again to retry.`,
  terminalOutputStopped: (cause: string) => `Terminal output stopped.\n${cause}`,
  /** @prose */
  terminalOutputNotKept: (cause: string) => `Terminal output not kept: ${cause}`,
  /** @prose */
  terminalZoomNotKept: (cause: string) => `Terminal text size not kept: ${cause}`,
  /** @prose */
  terminalSchemeNotSent: (cause: string) => `Terminal colour scheme not sent: ${cause}`,
  /** @prose */
  terminalOutputNotWatched: (cause: string) => `Terminal output not watched: ${cause}`,
  latest: "↓ Latest",
  findLabel: "Find in Terminal",
  findNoMatch: "No matches",
  /** @prose */
  linkNotOpened: (cause: string) => `link not opened: ${cause}`,
  /** @prose */
  pathNotFound: (path: string, tried: string) => `path not found: ${path} (tried ${tried})`,
  /** @prose */
  clipboardWriteLog: "Terminal clipboard write failed",
  /** @prose */
  unstartedLog: (kind: string) => `Terminal ${kind} failed without a user start`,
  openLinkLog: "open link failed",
} as const;

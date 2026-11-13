import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
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
  tabWithStatus: (name: string, status: string) => `${name}, ${status}`,
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
  noOutputKeptFromAnEarlierRun: "No output kept from an earlier run.",
  /** The first line is the failure; the cause follows it for the tooltip. */
  terminalRestoreFailed: (cause: string) => `Could not restore Terminal output.\n${cause}`,
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
  coreFailure_core_missing: "Terminals are not available on this Mac.",
  coreFailure_unsupported_generation: "Terminals need an update before they can start.",
  coreFailure_core_closed: "The Terminal connection was lost.",
  coreFailure_core_silent: "Terminals did not answer.",
  coreFailure_core_error: "The Terminal could not start.",
  coreFailure_core_protocol: "Terminals answered in a way the App cannot read.",
  coreFailure_core_io: "Terminals could not be reached.",
} as const;

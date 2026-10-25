/** App-authored terminal copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";

export const copy = {
  noWorkstreamYet: "No Workstream yet",
  timeline: shared.timeline,
  measurementUnknown: shared.measurementUnknown,
  measurementTime: shared.measurementTime,
  dismissFailure: shared.dismissFailure,
  newAgent: shared.newAgent,
  newTerminal: shared.newTerminal,
  retry: shared.retry,
  askBarShortcut: shared.askBarShortcut,
  measurementLoading: "Reading…",
  measurementMark: "*",
  /** @prose */
  measurementProblem: (cause: string) => `Measurements are unavailable: ${cause}. Refresh to try again.`,
  /** @prose */
  measurementDaemonEnded: "The Project stopped. Reopen it to reconnect.",
  measurementElapsed: (figure: string) => `${figure} elapsed`,
  measurementAgentTime: (figure: string) => `${figure} Agent time`,
  measurementSeparator: " · ",
  measurementSegment: (agent: string, category: string, duration: string, share: string) => [agent, category, duration, share].join(", "),
  measurementKeyEntry: (category: string, duration: string, share: string) => `${category} ${duration} · ${share}`,
  measurementPartial: "About this figure",
  /** @prose */
  measurementPartialTime: "Part of the history is not measured. This is the known part.",
  measurementTimeSpent: "Agent time",
  measurementExecution: "Agent work",
  measurementTools: shared.measurementTools,
  measurementCoordination: "Coordination",
  measurementOther: shared.measurementOther,
  measurementUnmeasured: "Unmeasured",
  /** @prose */
  measurementEmpty: "Nothing is measured yet.",
  /** @prose */
  measurementRemoved: (name: string) => `${name} was removed. Its recorded measurements remain here.`,
  measurementLoadMore: "Load more",
  start: "Start",

  /** @prose */
  selectAnAgentOrATerminal: "Choose an Agent or Terminal.",
  selectCommand: "Select command",
  creatingWorkstream: "Creating Workstream…",
  newWorkstreamWord: " New Workstream",
  /** @prose */
  noOutputKeptFromAnEarlierRun: "No output remains from an earlier run.",
  latest: "↓ Latest",
  /** @prose */
  doesNotExist: (value1: CopyValue) => `${value1} does not exist. Choose another item.`,
  noteTo: (name: string) => `Note to ${name}`,
  notesWaiting: (count: number) => `${count} waiting`,
  removeQueuedNote: (firstLine: string) => `Remove note: ${firstLine}`,
  decisionMaker: "decision-maker",
  removeGlyph: "×",
  ellipsis: "…",
} as const;

import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  title: sharedCopy.resumeUnfinished,
  resume: sharedCopy.resume,
  dismiss: sharedCopy.dismissFailure,
  rpcFailure: sharedCopy.rpcFailure,
  /** @prose */
  stopped: "This Agent stopped mid-work before the restart.",
  resuming: "Resuming…",
  /** @prose */
  checkFailed: (cause: string) =>
    `Unfinished work could not be checked. ${cause}`,
  /** @prose */
  resumedAgents: (count: number) =>
    count === 1 ? "Resumed 1 Agent." : `Resumed ${count} Agents.`,
  /** @prose */
  resumedSome: (resumed: number, total: number) =>
    `Resumed ${resumed} of ${total} Agents.`,
  /** @prose */
  nothingToResume: "No unfinished work to resume.",
};

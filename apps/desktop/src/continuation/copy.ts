import { copy as sharedCopy } from "../sharedCopy";

/** @prose */
const rpcFailures = new Map<number, string>([
  [-32700, "The request could not be read. Try again."], [-32601, "This action is unavailable. Check for an update."],
  [-32602, "Check the input and try again."], [-32603, "Completion is unconfirmed. Check before trying again."],
  [-32001, "The item is unavailable. Try again to check."], [-32002, "This action is not allowed. Check access before trying again."],
  [-32003, "The item was changed. Check the current item before trying again."], [-32004, "The reply was lost. Check before trying again."],
  [-32005, "The Agent is busy. Wait until it is idle."], [-32006, "Delivery is unconfirmed. Check the Agent before trying again."],
  [-32007, "The Agent is not running. Try again to check."], [-32008, "The interruption is unconfirmed. Check the Agent before trying again."],
  [-32009, "Earlier changes are unavailable. Reopen to check current work."], [-32010, "The inbox is unavailable. Check the Agent before trying again."],
  [-32011, "The roundup App is not open. Open it and try again."],
]);

export const copy = {
  title: sharedCopy.resumeUnfinished,
  resume: sharedCopy.resume,
  dismiss: sharedCopy.dismissFailure,
  /** @prose */
  rpcFailure: (code: number) => rpcFailures.get(code) ?? "Completion is unconfirmed. Keep your work and check before trying again.",
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

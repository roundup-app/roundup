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

/** @prose */
export const rpcFailure = (code: number): string => rpcFailures.get(code) ?? "Completion is unconfirmed. Keep your work and check before trying again.";

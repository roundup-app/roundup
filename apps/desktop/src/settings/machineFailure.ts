import { copy } from "./copy";

/** MC71: what the user reads when a Machine action fails: one sentence per failure kind, never the core's text. */
export type MachineAction = "add" | "remove" | "update" | "list";

const sentences = new Map<string, (name: string) => string>(Object.entries(copy.machineFailures));

/** The failure's kind: the word the Daemon leads its message with, empty when it leads with none. */
export const kindOf = (error: Error): string => /^([a-z][a-z_]*): /.exec(error.message)?.[1] ?? "";

/** The one sentence for `error` while doing `action` to `name`. */
export const machineFailure = (error: Error, action: MachineAction, name = ""): string => {
  const sentence = sentences.get(kindOf(error));

  if (sentence !== undefined) return sentence(name === "" ? copy.thatMachine : name);

  return copy.machineFailureFallback(copy.machineFailureVerbs[action], name === "" || action === "list" ? "" : ` ${name}`);
};

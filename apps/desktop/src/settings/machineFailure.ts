import { copy } from "./copy";

/** MC71: what the user reads when a Machine action fails: one sentence per failure kind, never the core's text. */
export type MachineAction = "add" | "remove" | "update" | "list";

const sentences = new Map<string, (name: string) => string>(Object.entries(copy.machineFailures));

/** The failure's kind: the word the Daemon or the App leads its message with, empty when it leads with none. */
export const kindOf = (message: string): string => /^([a-z][a-z_]*): /.exec(message)?.[1] ?? "";

/** The one sentence for `error` while doing `action` to `name`. */
export const machineFailure = (error: Error, action: MachineAction, name = ""): string => {
  const sentence = sentences.get(kindOf(error.message));

  if (sentence !== undefined) return sentence(name === "" ? copy.thatMachine : name);

  return copy.machineActionFailed[action](name);
};

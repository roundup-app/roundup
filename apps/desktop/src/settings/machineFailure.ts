/** MC71: what the user reads when a Machine action fails: one sentence per failure kind, never the core's text. */
export type MachineAction = "add" | "remove" | "update" | "list";

const table = {
  name_taken: (name: string) => `Another machine already uses the name ${name}. Pick a different name.`,
  already_added: (name: string) => `${name} is already added.`,
  unreachable: (name: string) => `Couldn't reach ${name} over ssh. Check the name and that ssh to it works from this computer, then try again.`,
  hc_missing: (name: string) => `herdr isn't installed on ${name}. Install it there, then try again.`,
  incompatible: (name: string) => `${name} runs a herdr that roundup can't use. Update it there, then try again.`,
  machine_unknown: (name: string) => `${name} isn't in your machine list any more. Reopen this page and try again.`,
  needs_update: (name: string) => `${name} needs a newer herdr. Use Update on its row.`,
  unavailable: () => "herdr isn't ready. Try again in a moment.",
  invalid_params: () => "roundup and herdr don't agree on this request. Update roundup, then try again.",
  core_missing: () => "herdr isn't installed on this computer. Install it, then reopen this page.",
  core_too_old: () => "The herdr on this computer is too old. Update it, then reopen this page.",
  core_closed: () => "herdr closed the connection. Try again.",
  core_silent: () => "herdr didn't answer. Try again in a moment.",
  update_failed: (name: string) => `Couldn't update ${name}. Check that ssh to it works, then try again.`,
  this_mac: () => "This computer can't be removed or updated here.",
};

const sentences = new Map<string, (name: string) => string>(Object.entries(table));

const verbs = { add: "add", remove: "remove", update: "update", list: "list machines" } satisfies Record<MachineAction, string>;

/** The failure's kind: the word the Daemon leads its message with, empty when it leads with none. */
export const kindOf = (error: Error): string => /^([a-z][a-z_]*): /.exec(error.message)?.[1] ?? "";

/** The one sentence for `error` while doing `action` to `name`. */
export const machineFailure = (error: Error, action: MachineAction, name = ""): string => {
  const sentence = sentences.get(kindOf(error));

  if (sentence !== undefined) return sentence(name === "" ? "That machine" : name);

  return `Couldn't ${verbs[action]}${name === "" || action === "list" ? "" : ` ${name}`}. Try again.`;
};

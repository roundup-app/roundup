/** MC56: the Daemon's coded answer when the Terminal host fails, in App words: no host name, code or hint. */
const LABELS = {
  core_missing: "Terminals are not available on this Mac.",
  unsupported_generation: "Terminals need an update before they can start.",
  core_closed: "The Terminal connection was lost.",
  core_silent: "Terminals did not answer.",
  core_error: "The Terminal could not start.",
  core_protocol: "Terminals answered in a way the App cannot read.",
  core_io: "Terminals could not be reached.",
} as const;

export type CoreFailureCode = keyof typeof LABELS;

export const coreFailureCodes: CoreFailureCode[] = ["core_missing", "unsupported_generation", "core_closed", "core_silent", "core_error", "core_protocol", "core_io"];

/** The label shown for `code`; a code the table lacks gets the generic one, never the code itself. */
export const coreFailureLabel = (code: string): string => new Map<string, string>(Object.entries(LABELS)).get(code) ?? LABELS.core_error;

/** The action beside the label: Retry reconnects first, then repeats the action (MC53). */
export const coreFailureAction = "Retry";

import { copy } from "./copy";

/** MC56: the Daemon's coded answer when the Terminal host fails, in App words: no host name, code or hint. */
const LABELS = {
  core_missing: copy.coreFailure_core_missing,
  unsupported_generation: copy.coreFailure_unsupported_generation,
  core_closed: copy.coreFailure_core_closed,
  core_silent: copy.coreFailure_core_silent,
  core_error: copy.coreFailure_core_error,
  core_protocol: copy.coreFailure_core_protocol,
  core_io: copy.coreFailure_core_io,
} as const;

export type CoreFailureCode = keyof typeof LABELS;

// SAFETY: LABELS is `as const`, so its keys are exactly CoreFailureCode.
export const coreFailureCodes = Object.keys(LABELS) as CoreFailureCode[];

const isCoreFailureCode = (code: string): code is CoreFailureCode => Object.hasOwn(LABELS, code);

/** The label shown for `code`; a code the table lacks gets the generic one, never the code itself. */
export const coreFailureLabel = (code: string): string => (isCoreFailureCode(code) ? LABELS[code] : LABELS.core_error);

/** The Daemon keeps a core failure's code at the start of its message (MC4): `core_closed: ...`, or `machine: core_closed: ...`. */
const SEGMENT = /^([^\s:]+): /;

/** `message` with a coded core failure replaced by its App label; any other message stays as it is. */
export const coreFailureText = (message: string): string => {
  const first = SEGMENT.exec(message);
  const head = first?.[1];

  if (first === null || head === undefined) return message;

  if (isCoreFailureCode(head)) return LABELS[head];

  const second = SEGMENT.exec(message.slice(first[0].length))?.[1];

  return second !== undefined && isCoreFailureCode(second) ? LABELS[second] : message;
};

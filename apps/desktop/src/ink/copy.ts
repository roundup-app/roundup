import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  statusAge: {
    now: "now",
    minutes: (value: number) => `${value} min`,
    hours: (value: number) => `${value} h`,
    days: (value: number) => `${value} d`,
    weeks: (value: number) => `${value} w`,
  },
  statusReveal: sharedCopy.dotted,
  statusAfterLabel: sharedCopy.dottedAfter,
  error: sharedCopy.error,
  retry: sharedCopy.retry,
  dismissFailure: sharedCopy.dismissFailure,
  dismissedFailure: sharedCopy.dismissedFailure,
  needsYouGlyph: sharedCopy.needsYouGlyph,
  blocked: sharedCopy.blocked,
  working: sharedCopy.working,
  idle: sharedCopy.idle,
  done: sharedCopy.done,
  exitedBySignal: sharedCopy.exitedBySignal,
  inboxEmpty: sharedCopy.inboxEmpty,
  openItem: sharedCopy.openEvidence,
  exited: "exited",
  exitedCode: (code: number) => `exited ${code}`,
} as const;

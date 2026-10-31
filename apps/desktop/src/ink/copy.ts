import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  statusAge: {
    now: "now",
    minutes: (value: number) => `${value} min`,
    hours: (value: number) => `${value} h`,
    days: (value: number) => `${value} d`,
    weeks: (value: number) => `${value} w`,
  },
  statusReveal: (reason: string, age: string) => `${reason} · ${age}`,
  error: sharedCopy.error,
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

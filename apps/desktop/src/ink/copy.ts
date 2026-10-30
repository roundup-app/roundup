import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  error: sharedCopy.error,
  needsYouGlyph: sharedCopy.needsYouGlyph,
  blocked: sharedCopy.blocked,
  working: sharedCopy.working,
  idle: sharedCopy.idle,
  done: sharedCopy.done,
  exitedBySignal: sharedCopy.exitedBySignal,
  inboxEmpty: sharedCopy.inboxEmpty,
  openItem: (name: string) => `Open ${name}`,
  exited: "exited",
  exitedCode: (code: number) => `exited ${code}`,
} as const;

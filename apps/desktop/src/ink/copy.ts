import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  error: shared.error,
  done: shared.done,
  needsYouGlyph: "Needs-you",
  blocked: shared.blocked,
  working: "Working",
  idle: shared.idle,
  userOwned: "User owned",
  agentOwned: "Agent owned",
  extensionOwned: "Extension owned",
  exitedCode: (code: number) => `exited ${code}`,
  exitedBySignal: "exited by signal",
  exited: "exited",
} as const;

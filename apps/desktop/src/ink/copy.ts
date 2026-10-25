/** App-authored ink copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

export const copy = {
  error: shared.error,
  blocked: shared.blocked,
  idle: shared.idle,
  done: shared.done,
  needsYouGlyph: "Needs-you",
  working: "Working",
  userOwned: "User owned",
  agentOwned: "Agent owned",
  extensionOwned: "Extension owned",
  exitedBySignal: "exited by signal",
  exited: "exited",
  exitedCode: (code: number) => `exited ${code}`,
} as const;

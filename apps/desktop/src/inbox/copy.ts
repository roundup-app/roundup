/** App-authored inbox copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

export const copy = {

  running: shared.running,
  needsYou: shared.needsYou,
  done: shared.done,

  inbox: shared.leaderShortInbox,
  inboxOpen: shared.openDraft,
  inboxDismiss: shared.dismissFailure,
  retry: shared.retry,
  /** @prose */
  inboxEmpty: "Nobody is waiting.",
  inboxRow: (agent: string, todo: string) => `Comment: ${agent}, ${todo}`,
  inboxRetry: "Retry Inbox",
  inboxLastStep: "Last step",
} as const;

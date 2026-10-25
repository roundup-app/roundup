import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  retry: shared.retry,
  needsYou: shared.needsYou,
  inbox: shared.leaderShortInbox,
  inboxEmpty: "Nothing waits for you",
  inboxRetry: "Retry Inbox",
  inboxRow: (agent: string, todo: string) => `${agent} commented on ${todo}`,
  running: shared.running,
  done: shared.done,
  inboxOpen: shared.openDraft,
  inboxLastStep: "Last step",
  inboxDismiss: shared.dismissFailure,
} as const;

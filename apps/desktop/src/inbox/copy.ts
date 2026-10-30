import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  copyDraftFailure: sharedCopy.copyDraftFailure,
  needsYou: sharedCopy.needsYou,
  inboxEmpty: sharedCopy.inboxEmpty,
  inboxRow: (agent: string, todo: string) => `${agent} commented on ${todo}`,
  inboxRetry: "Retry Inbox",
  inboxOpen: "Open",
  inboxLastStep: "Last step",
  inboxDismiss: "Dismiss",
  retry: sharedCopy.retry,
  copy: sharedCopy.copy,
} as const;

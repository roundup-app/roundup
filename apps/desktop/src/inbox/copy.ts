import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  copyDraftFailure: sharedCopy.copyDraftFailure,
  needsYou: sharedCopy.needsYou,
  inboxEmpty: sharedCopy.inboxEmpty,
  inboxRow: (agent: string, todo: string) => `${agent} on ${todo}`,
  inboxRetry: "Retry Inbox",
  inboxOpen: sharedCopy.openDraft,
  inboxLastStep: "Last step",
  inboxDismiss: sharedCopy.dismiss,
  retry: sharedCopy.retry,
  copy: sharedCopy.copy,
} as const;

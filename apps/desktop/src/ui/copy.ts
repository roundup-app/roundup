import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  close: shared.close,
  deliverableUnavailable: shared.deliverableUnavailable,
  linkUrl: shared.linkUrl,
  linkNote: shared.linkNote,
  copyDraftFailure: shared.copyDraftFailure,
  retry: shared.retry,
  cancel: shared.cancel,
  noMatch: shared.noMatch,
  resizeUnavailable: "Resizing is unavailable in this view.",
  sendToAgentMenu: "Send to Agent",
  copyLink: "Copy Link",
} as const;

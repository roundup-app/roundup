/** App-authored ui copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

export const copy = {
  deliverableUnavailable: shared.deliverableUnavailable,
  copyDraftFailure: shared.copyDraftFailure,
  close: shared.close,
  cancel: shared.cancel,
  retry: shared.retry,
  noMatch: shared.noMatch,
  linkUrl: shared.linkUrl,
  linkNote: shared.linkNote,
  /** @prose */
  resizeUnavailable: "Resizing is unavailable in this view.",
  sendToAgentMenu: "Send to Agent",
  copyLink: "Copy Link",
} as const;

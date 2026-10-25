type CopyValue = string | number | undefined;

import { draftProblem } from "../sharedCopy";
import { draftSurfaceLabels } from "../sharedCopy";
import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  close: shared.close,
  draftSurface: shared.draftSurface,
  copyDraftFailure: shared.copyDraftFailure,
  recoverDrafts: shared.recoverDrafts,
  unfinishedWork: shared.unfinishedWork,
  recoverDraftsCount: (count: number) => `Recover unfinished work (${count})`,
  draftProblem: draftProblem,
  tryAgain: shared.retryStorage,
  noUnfinishedWork: "No unfinished work in this project.",
  riskCause: { failed: "failed to save", unknown: "may not have saved", draft: "not saved for reload", left: "left unsent", gone: "original removed" },
  draftTitle: (place: string, name: string) => `${place} "${name}"`,
  riskLine: (cause: string, time: string) => `${cause} · ${time}`,
  riskTime: shared.riskTime,
  dismissCopyFailure: "Dismiss copy failure",
  openDraft: shared.openDraft,
  copyDraft: shared.copyDraft,
  discardRow: "Discard",
  drawer: "Drawer",
  lastTouch: (value1: CopyValue, value2: CopyValue, value3: CopyValue, value4: CopyValue) => `Last  ${value1} ${value2} ${value3}:${value4}`,
  padTouch: (value1: CopyValue, value2: CopyValue, value3: CopyValue) => `${value1} ${value2} this Pad at ${value3}`,
  you: "You",
  hasDraftSurface: (surface: string) => draftSurfaceLabels.has(surface),
} as const;

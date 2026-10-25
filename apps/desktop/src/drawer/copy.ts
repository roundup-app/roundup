/** App-authored drawer copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";
import { draftProblem, draftSurfaceLabels } from "../sharedCopy";
import type { CopyValue } from "../sharedCopy";

export const copy = {

  draftSurface: shared.draftSurface,
  recoverDrafts: shared.recoverDrafts,
  openDraft: shared.openDraft,
  copyDraft: shared.copyDraft,
  unfinishedWork: shared.unfinishedWork,
  tryAgain: shared.retryStorage,
  copyDraftFailure: shared.copyDraftFailure,
  close: shared.close,
  hasDraftSurface: (surface: string) => draftSurfaceLabels.has(surface),
  recoverDraftsCount: (count: number) => `Unfinished work (${count})`,
  riskCause: { failed: "failed to save", unknown: "save unconfirmed", draft: "unsaved for reload", left: "left unsent", gone: "original removed" },
  draftTitle: (place: string, name: string) => `${place} "${name}"`,
  riskLine: shared.riskLine,
  riskTime: shared.riskTime,
  discardRow: shared.discardRevision,
  /** @prose */
  noUnfinishedWork: "This Project has no unfinished work.",
  /** @prose */
  draftProblem,
  dismissCopyFailure: "Dismiss copy failure",
  drawer: "Drawer",
  lastTouch: (actor: CopyValue, verb: CopyValue, time: string) => `${actor} ${verb} ${time}`,
  /** @prose */
  padTouch: (actor: CopyValue, verb: CopyValue, time: CopyValue) => `${actor} has accessed this Pad at ${time} (${verb}).`,
  you: "You",
} as const;

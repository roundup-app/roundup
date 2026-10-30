import { copy as sharedCopy, draftSurfaceLabels, draftProblem } from "../sharedCopy";

export const clockTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn",
});

const touch = (name: string, verb: string, time: string) => `${name} ${verb} · ${time}`;

export const copy = {
  railDraftMissingTarget: sharedCopy.railDraftMissingTarget,
  draftSurface: sharedCopy.draftSurface,
  hasDraftSurface: (surface: string) => draftSurfaceLabels.has(surface),
  recoverDrafts: sharedCopy.recoverDrafts,
  recoverDraftsCount: (count: number) => `Recover unfinished work (${count})`,
  riskCause: { failed: "failed to save", unknown: "Save unconfirmed", draft: "Unsaved for reload", left: "left unsent", gone: "original removed" },
  draftTitle: (place: string, name: string) => `${place} "${name}"`,
  riskLine: sharedCopy.draftIdentity,
  riskTime: sharedCopy.riskTime,
  openDraft: sharedCopy.openDraft,
  copyDraft: sharedCopy.copy,
  discardRow: sharedCopy.discardRevision,
  unfinishedWork: sharedCopy.unfinishedWork,
  noUnfinishedWork: "This Project has no unfinished work.",
  draftProblem,
  tryAgain: sharedCopy.retryStorage,
  dismissCopyFailure: "Dismiss copy failure",
  copyDraftFailure: sharedCopy.copyDraftFailure,
  emptyDraftsLine: "Unfinished work you keep appears here.",
  pads: sharedCopy.pads,
  close: sharedCopy.close,
  drawer: sharedCopy.drawer,
  lastTouch: touch,
  padTouch: touch,
  maximise: sharedCopy.maximise,
  restore: sharedCopy.restore,
  you: sharedCopy.you,
} as const;

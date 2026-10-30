import { copy as sharedCopy, draftSurfaceLabels, draftProblem, type CopyValue } from "../sharedCopy";

export const clockTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn",
});

export const copy = {
  railDraftMissingTarget: sharedCopy.railDraftMissingTarget,
  draftSurface: sharedCopy.draftSurface,
  hasDraftSurface: (surface: string) => draftSurfaceLabels.has(surface),
  recoverDrafts: sharedCopy.recoverDrafts,
  recoverDraftsCount: (count: number) => `Recover unfinished work (${count})`,
  riskCause: { failed: "failed to save", unknown: "may not have saved", draft: "not saved for reload", left: "left unsent", gone: "original removed" },
  draftTitle: (place: string, name: string) => `${place} "${name}"`,
  riskLine: (cause: string, time: string) => `${cause} · ${time}`,
  riskTime: sharedCopy.riskTime,
  openDraft: sharedCopy.openDraft,
  copyDraft: "Copy",
  discardRow: sharedCopy.discardRevision,
  unfinishedWork: sharedCopy.unfinishedWork,
  noUnfinishedWork: "This Project has no unfinished work.",
  draftProblem,
  tryAgain: "Try again",
  dismissCopyFailure: "Dismiss copy failure",
  copyDraftFailure: sharedCopy.copyDraftFailure,
  emptyDraftsLine: "Unfinished work you keep appears here.",
  pads: sharedCopy.pads,
  close: sharedCopy.close,
  drawer: sharedCopy.drawer,
  lastTouch: (name: string, verb: string, time: string) => `Last  ${name} ${verb} ${time}`,
  padTouch: (value1: CopyValue, value2: CopyValue, value3: CopyValue) => `${value1} ${value2} this Pad at ${value3}`,
  maximise: sharedCopy.maximise,
  restore: sharedCopy.restore,
  you: "You",
} as const;

/** App-authored header copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";

export const copy = {
  draftIdentity: shared.draftIdentity,
  recoverDrafts: shared.recoverDrafts,

  unfinishedWork: shared.unfinishedWork,
  copyProjectName: shared.copyProjectName,
  currentDraft: shared.currentDraft,
  draftStatus: shared.draftStatus,
  storageRetry: shared.storageRetry,
  discardRevision: shared.discardRevision,
  draftRetention: shared.draftRetention,
  copyDraftFailure: shared.copyDraftFailure,
  close: shared.close,
  closeQuestion: shared.closeQuestion,
  cancel: shared.cancel,
  rename: shared.rename,
  closeProject: shared.closeProject,
  error: shared.error,
  needsYou: shared.needsYou,
  railDraftConflict: shared.railDraftConflict,
  copy: shared.copyDraft,
  comma: shared.comma,
  unseenMark: shared.unseenMark,
  unreadResult: shared.unreadResult,
  andMore: (value1: CopyValue) => ` and ${value1} more`,
  /** @prose */
  closingStopsThem: "Closing stops them.",
  stopAndClose: "Stop and close",
  projectName: shared.projectName,
  hiddenAttention: (value1: CopyValue, value2: CopyValue, value3: CopyValue) => `${value1} ${value2} ${value3}`,
  projects: "Projects",
  openAFolder: "Open a Project",
  addProjectMark: "+",
  /** @prose */
  needYouError: (value1: CopyValue, value2: CopyValue) => `${value1} need you; ${value2} have errors.`,
  /** @prose */
  runningAgents: (count: number, names: string, more: string) => `${count === 1 ? "There is" : "There are"} ${count} running ${count === 1 ? shared.draftSurface("agent") : shared.settingsAgents}: ${names}${more}.`,
  previousProjectsMark: "◂ ",
  nextProjectsMark: " ▸",
  roundup: "roundup",
  left: "left",
  right: "right",
} as const;

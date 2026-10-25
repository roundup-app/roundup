/** App-authored importer copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";

const importExcludedReasons: [string[], string][] = [
  [["already in this project"], "It was already imported."],
  [["ambiguous project membership"], "It uses several directories in this Project."],
  [["no recorded working directory", "too many recorded directories", "recorded folder no longer exists"], "Its directory is no longer there."],
  [["inside a worktree"], "It is in a Worktree."],
  [["duplicate source identity"], "It is already listed."],
  [["activity unknown or in the future", "no complete records"], "No usable time was recorded."],
];

const reasonIs = (reason: string, fixed: string) => reason === fixed || reason.endsWith(`: ${fixed}`);

export const copy = {
  /** @prose */
  importRowFix: "Choose it again, or Refresh.",
  retryStorage: shared.retryStorage,

  copyDraftFailure: shared.copyDraftFailure,
  cancel: shared.cancel,
  importRefresh: shared.importRefresh,
  importUnnamed: shared.importUnnamed,
  copy: shared.copyDraft,
  importTitle: "Import work",
  importPeriod: "Period",
  importPeriodName: (value1: "day" | "week" | "month") => `Last ${value1}`,
  importLooking: "Looking for conversations…",
  /** @prose */
  importNone: "No conversations were found in this period.",
  importResults: "Conversations",
  importConfirm: (value1: CopyValue) => value1 === 0 ? "Import" : `Import ${value1}`,
  importChoices: "Saved Import choices",
  importConflict: "Import choices conflict",
  /** @prose */
  importConflictExplanation: "Import choices have changed in another window. Both versions stay here. Open either version to review it. Discard only the version you no longer need.",
  importChoice: (number: number) => `Import choices ${number}`,
  importOpenChoice: (number: number) => `Open choices ${number}`,
  importDiscardChoice: (number: number) => `Discard choices ${number}`,
  /** @prose */
  importRestoreFailure: "Import choices could not be restored. Saved choices will be kept until storage recovers.",
  /** @prose */
  importRetentionFailure: "Import choices could not be saved for reload.",
  /** @prose */
  importRetentionRecovery: "Keep this window open; your choices are still here.",
  /** @prose */
  importRestored: (count: number) => `${count} were chosen earlier. Refresh to check they are unchanged.`,
  importNotImportable: (count: number) => `${count} not importable`,
  /** @prose */
  importExcludedReason: (reason: string) => {
    const r = reason.toLowerCase();
    const found = r.startsWith("missing directory ") ? importExcludedReasons[2] : importExcludedReasons.find(([fixed]) => fixed.some((f) => reasonIs(r, f)));

    return found ? found[1] : "This conversation could not be read. Choose another one.";
  },
  importAge: (minutes: number) => minutes < 1440 ? shared.riskTime(minutes) : `${Math.floor(minutes / 1440)} d ago`,
  /** @prose */
  importRowRefusal: (reason: string) => /retry|refresh|choose/i.test(reason) ? reason : `${reason} ${copy.importRowFix}`,
  importLocation: (cwd: string, project: string) => cwd === "" ? project : cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? project,
} as const;

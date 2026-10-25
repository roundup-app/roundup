type CopyValue = string | number | undefined;

import { copy as shared } from "../sharedCopy";

const importExcludedReasons: [string[], string][] = [
  [["already in this project"], "Already imported"],
  [["ambiguous project membership"], "Used more than one folder of this Project"],
  [["no recorded working directory", "too many recorded directories", "recorded folder no longer exists"], "Its folder is no longer there"],
  [["inside a worktree"], "Lives in a Worktree"],
  [["duplicate source identity"], "Already listed once"],
  [["activity unknown or in the future", "no complete records"], "No usable time"],
];

const reasonIs = (reason: string, fixed: string) => reason === fixed || reason.endsWith(`: ${fixed}`);

/** App-authored copy owned by this surface (U471). */
export const copy = {
  copy: shared.copyDraft,
  copyDraftFailure: shared.copyDraftFailure,
  cancel: shared.cancel,
  importTitle: "Import Claude Code work",
  importPeriod: "Period",
  importPeriodName: (value1: "day" | "week" | "month") => `Last ${value1}`,
  importResults: "Conversations",
  importRestoreFailure: "Import choices could not be restored. Saved choices will be kept until storage recovers.",
  importRetentionFailure: "Import choices could not be saved for reload.",
  importRetentionRecovery: "Keep this window open; your choices are still here.",
  importConflict: "Import choices conflict",
  importConflictExplanation: "Import choices changed in another window. Both versions are kept separately. Open either version to review it, or discard only the version you no longer need.",
  importRestored: (count: number) => `${count} chosen earlier; refresh to check they are unchanged`,
  importLooking: "Looking for conversations…",
  importNone: "No conversations to import in this period.",
  retryStorage: shared.retryStorage,
  importChoices: "Saved Import choices",
  importChoice: (number: number) => `Import choices ${number}`,
  importUnnamed: shared.importUnnamed,
  importOpenChoice: (number: number) => `Open choices ${number}`,
  importDiscardChoice: (number: number) => `Discard choices ${number}`,
  importLocation: (cwd: string, project: string) => cwd === "" ? project : cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? project,
  importAge: (minutes: number) => minutes < 1440 ? copy.riskTime(minutes) : `${Math.floor(minutes / 1440)} d ago`,
  importRowRefusal: (reason: string) => /retry|refresh|choose/i.test(reason) ? reason : `${reason} ${copy.importRowFix}`,
  importNotImportable: (count: number) => `${count} not importable`,
  importExcludedReason: (reason: string) => {
    const r = reason.toLowerCase();
    const found = r.startsWith("missing directory ") ? importExcludedReasons[2] : importExcludedReasons.find(([fixed]) => fixed.some((f) => reasonIs(r, f)));

    return found ? found[1] : "Can't be read as a conversation";
  },
  importRefresh: shared.importRefresh,
  importConfirm: (value1: CopyValue) => value1 === 0 ? "Import" : `Import ${value1}`,
  riskTime: shared.riskTime,
  importRowFix: "Choose it again, or Refresh.",
} as const;

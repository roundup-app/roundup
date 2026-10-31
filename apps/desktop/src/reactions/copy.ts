import type { Observation } from "@contracts/reaction/Observation";
import type { ObservationCause } from "@contracts/reaction/ObservationCause";
import type { ObservationGap } from "@contracts/reaction/ObservationGap";
import type { ObservationRecovery } from "@contracts/reaction/ObservationRecovery";
import type { ObservationHealth } from "@contracts/reaction/ObservationHealth";
import type { Reason } from "@contracts/message/Reason";

import { copy as sharedCopy } from "../sharedCopy";

const unexplained = "Observation unclear";

const byYou = "Run by you";

const rearms = "Re-arms";

const prChanged = "PR changed";

const observationUnavailable = "Observation unavailable";

const deliveryUnknown = "Delivery unknown";

const reactionHealth = new Map<ObservationHealth, string>([["fired", "Sent on time"], ["fired-late", "Sent late"], ["expired", "Expired unsent"], ["skipped", "Missed, skipped"], ["observing", "Watching changes"], ["not-observing", "Not watching yet"], ["unavailable", observationUnavailable], ["waiting", "Waiting for checks"], ["matched", "Condition met"], ["invalidated", prChanged], ["acceptance-failed", "Accept failed"], ["write-failed", "Save failed"], ["observation-save-failed", "Observation unsaved"]]);

const reactionStates = new Map([["stopped", "Stopped"], ["invalidated", prChanged]]);

const reactionDelivery = new Map([["pending", "Waiting to send"], ["delivered", "Delivered"], ["dropped", "Not delivered"], ["sending", "Sending"], ["passed", "Passed on"]]);

const reactionCauses: Record<ObservationCause, string> = {
  "head-moved": "The PR has new commits. Create a new reaction for the current version.",
  "agent-unavailable": "An Agent is no longer available. Stop this reaction and choose an available Agent in a new one.",
  "authority-refused": "Permission to reach the Agent was refused. You can inspect or stop this reaction.",
  "checks-failed": "A required check did not pass on the selected version. Check the PR before trying again.",
  "checks-pending": "Waiting for required checks to finish on the selected version.",
  "checks-unavailable": "PR checks are unavailable. Check your GitHub login and connection, then refresh.",
  "worktree-read-failed": "Could not read the Agent's work. Refresh before checking again.",
  "pr-missing": "The Agent's work has no matching PR. Check its PR or choose another Agent in a new reaction.",
  "evidence-missing": "No required-check results are available. Refresh to check again.",
  "evidence-stale": "Check results are out of date. Refresh to read the current results.",
  "forge-read-failed": "Could not read GitHub. Check your connection, then refresh.",
  "head-missing": "The PR's current version is unavailable. Refresh to check again.",
  "repository-mismatch": "The Agent's PR belongs to another repository. Create a reaction for the correct PR.",
  "unknown": "Observation details could not be explained. Refresh to check again.",
  "unsupported": "This source cannot be watched. Stop this reaction and choose a supported condition.",
  "firings-read-failed": "Could not read accepted firings. Refresh before checking again.",
  "cursor-missing": "The accepted firing has no source record. Restore its evidence before checking again.",
  "acceptance-failed": "Could not accept the firing. Check the Agent and storage before trying again.",
  "observation-save-failed": "Could not save observation. Check storage before trying again."
};

const reactionGaps: Record<ObservationGap, string> = {
  "unknown": "Earlier observation details could not be explained. Refresh to check again.",
  "history-expired": "Earlier activity could not be read. This gap remains in the history.",
  "agent-read-failed": "Agent activity could not be read. Nothing matched during that gap.",
  "events-read-failed": "Agent activity could not be read. Nothing matched during that gap.",
  "firings-read-failed": "Could not read accepted firings. Refresh before checking again.",
  "cursor-missing": "The accepted firing has no source record. Restore its evidence before checking again.",
  "agent-unavailable": "An Agent is no longer available. Stop this reaction and choose an available Agent in a new one.",
  "authority-refused": "Permission to reach the Agent was refused. You can inspect or stop this reaction."
};

const reactionRecoveries: Record<ObservationRecovery, string> = {
  "unknown": "Refresh to check current observation.",
  "check": "Refresh to check current observation.",
  "reconciled": "Current Agent activity is available again; the earlier gap remains.",
  "replace-agent": "Stop this reaction and create one with an available Agent.",
  "replace-target": "Inspect or stop this reaction; create a new one with an authorized Agent.",
  "restore-evidence": "Restore the accepted firing\u2019s source evidence before checking again.",
  "retry-acceptance": "Check the Agent and storage; observation retries within the saved bound and expiry.",
  "retry-storage": "Check storage; the next observation retries saving retained progress.",
  "reconcile": "Check current Agent activity; the earlier gap remains."
};

const reactionReasons: Record<Reason, string> = {
  "receiver gone": "The original Agent is no longer available. Choose an available Agent for new work.",
  "not accepted": "The Agent did not accept this Message. Check the Agent before retrying.",
  "removed": "This Message was removed before delivery.",
  "merged": "A newer summary includes it."
};

export const copy = {
  closeView: sharedCopy.closeView,
  draftIdentity: sharedCopy.draftIdentity,
  copyDraftFailure: sharedCopy.copyDraftFailure,
  retry: sharedCopy.retry,
  unavailableHome: sharedCopy.unavailableHome,
  clear: sharedCopy.clear,
  refresh: sharedCopy.refresh,
  reactions: sharedCopy.reactions,
  reactionsEmpty: sharedCopy.reactionsEmpty,
  reactionStop: sharedCopy.stop,
  reactionRun: "Run now",
  reactionMissing: "This reaction is gone.",
  reactionDetail: (name: string) => `Reaction ${name}`,
  reactionState: (state: string, health: ObservationHealth = "unknown") => state === "active" ? reactionHealth.get(health) ?? observationUnavailable : reactionStates.get(state) ?? "Unavailable",
  reactionTarget: "Target Agent",
  reactionInstruction: "Instruction",
  reactionCondition: "Condition",
  reactionExpires: "Expires",
  reactionWhen: sharedCopy.reactionWhen,
  reactionAuthority: "Maker",
  reactionActor: (kind: string, name: string | null) => kind === "user" ? sharedCopy.you : name === null ? "Maker unavailable" : name,
  reactionMakerReason: "Reason",
  reactionHome: "Home",
  reactionNoHome: sharedCopy.projectRoot,
  reactionGone: () => sharedCopy.unavailableAgent,
  reactionBound: "Bound",
  reactionRemaining: (remaining: number, max: number, rearm: boolean) => sharedCopy.draftIdentity(`${remaining}/${max} left`, ...(rearm ? [rearms] : [])),
  reactionHealth: (health: ObservationHealth = "unknown") => reactionHealth.get(health) ?? unexplained,
  reactionDelivery: (status: string) => reactionDelivery.get(status) ?? deliveryUnknown,
  reactionFeedback: (observation: Observation) => {
    const cause = observation.cause_code !== "unknown" || (observation.cause !== undefined && observation.cause !== null)
      ? reactionCauses[observation.cause_code]
      : observation.gap_code !== "unknown" || observation.gap !== null ? reactionGaps[observation.gap_code]
        : observation.health_code === "unknown" || observation.health_code === "unavailable" ? reactionCauses.unknown : null;

    const recovery = observation.cause_code !== "unsupported" && (cause || observation.recovery_code !== "unknown" || observation.recovery !== null)
      ? reactionRecoveries[observation.recovery_code] : null;

    return [cause, recovery].filter(Boolean).join(" ") || null;
  },
  reactionReason: (reason: Reason) => reactionReasons[reason],
  reactionUnknownState: unexplained,
  reactionUnknownEvidence: "Observation details could not be explained. Copy includes the original details.",
  reactionDetails: "Details",
  reactionObservation: "Observation",
  reactionMessage: (_id: number) => "Message",
  reactionMessageState: "Delivery",
  reactionFirings: "Firings",
  reactionNoFirings: "None yet",
  reactionFiring: (ordinal: number, outcome: string, matched: boolean) => sharedCopy.draftIdentity(`Firing ${ordinal}`, reactionDelivery.get(outcome) ?? deliveryUnknown, ...(matched ? [] : [byYou])),
  reactionAgents: (names: string[], any: boolean) => `${any ? "Any of" : "All of"} ${names.join(", ")} finish.`,
  reactionPrChecks: (repository: string, number: number) => `Checks pass on ${repository}#${number}.`,
  reactionInstant: (at: string, late: string) => `At ${at}; ${late === "skip" ? "skip if missed" : "run once before expiry if missed"}.`,
  copy: sharedCopy.copy,
} as const;

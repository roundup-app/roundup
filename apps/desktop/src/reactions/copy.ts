/** App-authored reactions copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";
import type { Observation } from "@contracts/reaction/Observation";
import type { ObservationCause } from "@contracts/reaction/ObservationCause";
import type { ObservationGap } from "@contracts/reaction/ObservationGap";
import type { ObservationRecovery } from "@contracts/reaction/ObservationRecovery";
import type { ObservationHealth } from "@contracts/reaction/ObservationHealth";
import type { Reason } from "@contracts/message/Reason";

const checkObservation = "Refresh to check current observation.";

const activityUnreadable = "Agent activity could not be read. No condition was met during that gap.";

const firingSourceMissing = "The accepted firing has no source record. Restore its evidence before checking again.";

const firingsUnreadable = "Could not read accepted firings. Refresh before checking again.";

const authorityRefused = "Permission to reach the Agent was refused. You can inspect or stop this reaction.";

const agentUnavailable = "An Agent is no longer available. Stop this reaction. Choose an available Agent for a new reaction.";


const reactionCauses: Record<ObservationCause, string> = {
  "head-moved": "The PR has new commits. Create a new reaction for the current version.",
  "agent-unavailable": agentUnavailable,
  "authority-refused": authorityRefused,
  "checks-failed": "A required check did not pass on the selected version. Check the PR before trying again.",
  "checks-pending": "It waits for required checks on the selected version.",
  "checks-unavailable": "PR checks are unavailable. Check your GitHub login and connection, then refresh.",
  "worktree-read-failed": "Could not read the Agent's work. Refresh before checking again.",
  "pr-missing": "The Agent's work has no matching PR. Check its PR. Or choose another Agent in a new reaction.",
  "evidence-missing": "No required-check results are available. Refresh to check again.",
  "evidence-stale": "Check results are out of date. Refresh to read the current results.",
  "forge-read-failed": "Could not read GitHub. Check your connection, then refresh.",
  "head-missing": "The PR's current version is unavailable. Refresh to check again.",
  "repository-mismatch": "The Agent's PR belongs to another repository. Create a reaction for the correct PR.",
  "unknown": "Observation details could not be explained. Refresh to check again.",
  "unsupported": "This source cannot be watched. Stop this reaction and choose a supported condition.",
  "firings-read-failed": firingsUnreadable,
  "cursor-missing": firingSourceMissing,
  "acceptance-failed": "Could not accept the firing. Check the Agent and storage before trying again.",
  "observation-save-failed": "Could not save observation. Check storage before trying again."
};

const reactionGaps: Record<ObservationGap, string> = {
  "unknown": "Earlier observation details could not be explained. Refresh to check again.",
  "history-expired": "Earlier activity could not be read. This gap remains in the history.",
  "agent-read-failed": activityUnreadable,
  "events-read-failed": activityUnreadable,
  "firings-read-failed": firingsUnreadable,
  "cursor-missing": firingSourceMissing,
  "agent-unavailable": agentUnavailable,
  "authority-refused": authorityRefused
};

const reactionRecoveries: Record<ObservationRecovery, string> = {
  "unknown": checkObservation,
  "check": checkObservation,
  "reconciled": "Current Agent activity is available again; the earlier gap remains.",
  "replace-agent": "Stop this reaction and create one with an available Agent.",
  "replace-target": "Inspect or stop this reaction. Create one with an authorized Agent.",
  "restore-evidence": "Restore the accepted firing\u2019s source evidence before checking again.",
  "retry-acceptance": "Check the Agent and storage. It will try again within the saved bound and expiry.",
  "retry-storage": "Check storage; the next observation retries saving progress.",
  "reconcile": "Check current Agent activity; the earlier gap remains."
};

const reactionReasons: Record<Reason, string> = {
  "receiver gone": "The original Agent is no longer available. Choose an available Agent for new work.",
  "not accepted": "The Agent did not accept this Message. Check the Agent before retrying.",
  "removed": "You chose to remove this Message before delivery.",
  "merged": "A newer summary includes it."
};



const reactionChanged = "The PR has changed.";

const reactionUnavailable = "Observation is unavailable. Refresh to check again.";

const delivered = "Delivered";

const sending = "Sending";

const reactionFiringStates = new Map([["pending", shared.draftStatus.pending], ["delivered", delivered], ["sending", sending], ["dropped", shared.askDropped], ["passed", "Forwarded"]]);

const reactionDelivery = new Map([["pending", shared.draftStatus.pending], ["delivered", delivered], ["dropped", "Not delivered"], ["sending", sending], ["passed", "Passed on"]]);

const reactionHealth = new Map<ObservationHealth, string>([["fired", "It sent on time."], ["fired-late", "It sent late."], ["expired", "It expired before sending."], ["skipped", "It missed the time and skipped as requested."], ["observing", "It is watching for changes."], ["not-observing", "It waits to start watching."], ["unavailable", reactionUnavailable], ["waiting", "It waits for checks."], ["matched", "The condition was met."], ["invalidated", reactionChanged], ["acceptance-failed", "Could not accept the firing; check again"], ["write-failed", "Could not save the firing; check again"], ["observation-save-failed", "Could not save observation; retry storage"]]);

const reactionStates = new Map([["stopped", "Stopped"], ["invalidated", "PR changed"], ["fired", "Sent on time"], ["fired-late", "Sent late"], ["expired", "Expired"], ["skipped", "Missed; skipped"], ["observing", "Watching"], ["not-observing", "Awaiting observation"], ["unavailable", "Observation unavailable"], ["waiting", "Awaiting checks"], ["matched", "Condition met"], ["acceptance-failed", "Firing refused"], ["write-failed", "Firing save failed"], ["observation-save-failed", "Observation save failed"]]);

const reactionFirings = "Firings";

export const copy = {
  reactionFiringLabel: (ordinal: number, outcome: string) => `Firing ${ordinal} · ${reactionFiringStates.get(outcome) ?? shared.timelineUnknown}`,
  reactionFirings: reactionFirings,

  draftSurface: shared.draftSurface,
  draftIdentity: shared.draftIdentity,

  storageRetry: shared.storageRetry,
  draftRetention: shared.draftRetention,
  copyDraftFailure: shared.copyDraftFailure,

  retry: shared.retry,

  unavailableHome: shared.unavailableHome,

  clear: shared.clear,

  refresh: shared.importRefresh,
  reactionStop: shared.stop,
  reactionName: shared.name,
  reactionTime: shared.measurementTime,
  reactionWhen: shared.reactionWhen,
  reactionNoHome: shared.projectRoot,
  copy: shared.copyDraft,
  reactions: "Named reactions",
  reactionUtc: "Z",
  reactionDatePlaceholder: "2026-10-21",
  reactionTimePlaceholder: "09:00",
  reactionOffsetPlaceholder: "+01:00",
  reactionRepositoryPlaceholder: "owner/name",
  /** @prose */
  reactionPreviewActor: "You have authorized this from the App.",
  reactionsEmpty: "No reactions yet",
  reactionCreate: "New reaction",
  reactionSave: "Save reaction",
  reactionRun: "Run now",
  /** @prose */
  reactionMissing: "This reaction is no longer listed. Refresh to check again.",
  reactionDetail: (name: string) => `Reaction ${name}`,
  reactionCheckCreation: "Check creation",
  /** @prose */
  reactionCreationUnknown: (cause: string) => `Creation is unconfirmed. Check creation before saving another reaction. ${cause}`,
  /** @prose */
  reactionNotCreated: (cause: string) => `The reaction was not created: ${cause}. Check before trying again.`,
  reactionState: (state: string, health: ObservationHealth = "unknown") => reactionStates.get(state === "active" ? health : state) ?? "Unavailable",
  reactionTarget: "Target Agent",
  reactionPickTarget: "Pick an Agent",
  reactionInstruction: "Instruction",
  reactionCondition: "Condition",
  reactionKindAgents: "Agents finish",
  reactionKindPr: "PR checks pass",
  reactionKindInstant: "At a time",
  reactionWatched: "Agents to watch",
  reactionAny: "Any Agent",
  /** @prose */
  reactionAnyHint: "Otherwise, all watched Agents must finish.",
  reactionRepository: "Repository",
  reactionPr: "PR number",
  reactionAt: "At",
  reactionDate: "Date",
  reactionOffset: "UTC offset",
  reactionExpires: "Expires",
  reactionMax: reactionFirings,
  reactionRearm: "Rearm each time",
  reactionPreview: "Preview",
  reactionIncomplete: "Not complete yet",
  reactionAuthority: "Authority",
  reactionActor: (kind: string, name: string | null) => kind === "user" ? "Authorized by you" : name === null ? "Authorizer unavailable" : `Authorized by ${name}`,
  reactionHome: "Home",
  reactionGone: () => shared.unavailableAgent,
  reactionBound: "Bound",
  /** @prose */
  reactionRemaining: (remaining: number, max: number, rearm: boolean) => `${remaining} of ${max} firings remain${rearm ? "; it re-arms" : ""}.`,
  /** @prose */
  reactionHealth: (health: ObservationHealth = "unknown") => reactionHealth.get(health) ?? "Observation details could not be explained.",
  reactionDelivery: (status: string) => reactionDelivery.get(status) ?? "Delivery unknown",
  /** @prose */
  reactionFeedback: (observation: Observation) => {
    const cause = observation.cause_code !== "unknown" || (observation.cause !== undefined && observation.cause !== null)
      ? reactionCauses[observation.cause_code]
      : observation.gap_code !== "unknown" || observation.gap !== null ? reactionGaps[observation.gap_code]
        : observation.health_code === "unknown" || observation.health_code === "unavailable" ? reactionCauses.unknown : null;

    const recovery = observation.cause_code !== "unsupported" && (cause || observation.recovery_code !== "unknown" || observation.recovery !== null)
      ? reactionRecoveries[observation.recovery_code] : null;

    return cause ? recovery ? `${cause} ${recovery}` : cause : recovery;
  },
  /** @prose */
  reactionReason: (reason: Reason) => reactionReasons[reason],
  reactionUnknownState: "Observation unclear",
  /** @prose */
  reactionUnknownEvidence: "Observation details could not be explained. Copy includes the original details.",
  reactionDetails: "Details",
  reactionObservation: "Observation",
  reactionMessage: (_id: number) => "Message",
  reactionMessageState: "Delivery",
  reactionNoFirings: "None yet",
  /** @prose */
  reactionFiring: (ordinal: number, _message: number, outcome: string, matched: boolean) => `Firing ${ordinal} is ${reactionDelivery.get(outcome) ?? "unknown"}${matched ? "" : "; you ran it"}.`,
  /** @prose */
  reactionAgents: (names: string[], any: boolean) => `${any ? "Any" : "All"} of ${names.join(", ")} finish.`,
  /** @prose */
  reactionPrChecks: (repository: string, number: number) => `Checks pass on ${repository}#${number}.`,
  /** @prose */
  reactionInstant: (at: string, late: string) => `It runs at ${at}; ${late === "skip" ? "it skips missed times" : "it runs once before expiry if missed"}.`,
  /** @prose */
  reactionResolved: (preview: { at: string; utc: string; offset: string }) => `It runs at ${preview.at} (${preview.utc} UTC, ${preview.offset}).`,
} as const;

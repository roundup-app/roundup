import { copy as shared } from "../sharedCopy";

const reactionStates = new Map([["stopped", "Stopped"], ["invalidated", "PR changed"]]);

const reactionHealth = new Map([["fired", "Sent at the scheduled time"], ["fired late", "Sent after the scheduled time"], ["expired: no firing at or after expires_at", "Expired before sending"], ["skipped: the instant was missed and the late policy is skip", "Scheduled time missed; skipped as requested"], ["observing", "Watching for changes"], ["not-observing", "Waiting to start watching"], ["unavailable", "Observation unavailable"], ["waiting", "Waiting for checks"], ["matched", "Condition met"], ["invalidated", "PR changed"], ["acceptance-failed", "Could not accept the firing; check again"], ["write-failed", "Could not save the firing; check again"], ["observation-save-failed", "Could not save observation; retry storage"]]);

const reactionDelivery = new Map([["pending", "Waiting to send"], ["delivered", "Delivered"], ["dropped", "Not delivered"], ["sending", "Sending"], ["passed", "Passed on"]]);

const reactionMax = "Firings";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  copy: shared.copyDraft,
  draftRetention: shared.draftRetention,
  draftSurface: shared.draftSurface,
  storageRetry: shared.storageRetry,
  copyDraftFailure: shared.copyDraftFailure,
  unavailableHome: shared.unavailableHome,
  refresh: shared.importRefresh,
  reactionWhen: shared.reactionWhen,
  draftIdentity: shared.draftIdentity,
  retry: shared.retry,
  reactionUtc: "Z",
  reactionGone: () => "Unavailable Agent",
  reactionUnknownEvidence: "Observation details could not be explained. Copy includes the original details.",
  reactionAgents: (names: string[], any: boolean) => `${any ? "Any of" : "All of"} ${names.join(", ")} finish`,
  reactionPrChecks: (repository: string, number: number) => `Checks pass on ${repository}#${number}`,
  reactionInstant: (at: string, late: string) => `At ${at}; ${late === "skip" ? "skip if missed" : "run once before expiry if missed"}`,
  reactions: "Named reactions",
  reactionMissing: "This reaction is no longer listed",
  reactionDetail: (name: string) => `Reaction ${name}`,
  clear: shared.clear,
  reactionStop: shared.stop,
  reactionRun: "Run now",
  reactionCreate: "New reaction",
  reactionsEmpty: "No named reactions yet",
  reactionUnknownState: "Observation unclear",
  reactionState: (state: string, health: string) => state === "active" ? reactionHealth.get(health) ?? "Observation unavailable" : reactionStates.get(state) ?? "Unavailable",
  reactionHealth: (health: string) => reactionHealth.get(health) ?? "Observation details could not be explained.",
  reactionActor: (kind: string, name: string | null) => kind === "user" ? "Authorized by you" : name === null ? "The authorizing Agent is unavailable" : `Authorized by ${name}`,
  reactionAuthority: "Authority",
  reactionHome: "Home",
  reactionNoHome: shared.projectRoot,
  reactionTarget: "Target Agent",
  reactionInstruction: "Instruction",
  reactionCondition: "Condition",
  reactionBound: "Bound",
  reactionRemaining: (remaining: number, max: number, rearm: boolean) => `${remaining} of ${max} firings left${rearm ? ", re-arms" : ""}`,
  reactionExpires: "Expires",
  reactionObservation: "Observation",
  reactionCause: (cause: string) => cause.startsWith("the PR head moved") ? "The PR has new commits. Create a new reaction for the current version."
    : cause.includes("no longer names an Agent with a state") ? "An Agent is no longer available. Stop this reaction and choose an available Agent in a new one."
    : cause.startsWith("authority refused:") ? "Permission to reach the Agent was refused. You can inspect or stop this reaction."
    : cause === "a required check did not pass on the pinned head" ? "A required check did not pass on the selected version. Check the PR before trying again."
    : cause === "a required check is pending, or none is required" || cause === "no required check concluded" ? "Waiting for required checks to finish on the selected version."
    : cause === "no usable gh, login, GitHub remote or answer in time" ? "PR checks are unavailable. Check your GitHub login and connection, then refresh."
    : cause.startsWith("the Worktree read failed:") ? "Could not read the Agent's work. Refresh before checking again."
    : cause.startsWith("the Worktree holds no PR ") ? "The Agent's work has no matching PR. Check its PR or choose another Agent in a new reaction."
    : cause === "no required-check evidence" ? "No required-check results are available. Refresh to check again."
    : cause === "the evidence is stale; the last refresh failed or is old" ? "Check results are out of date. Refresh to read the current results."
    : cause === "the forge read failed without a reason" ? "Could not read GitHub. Check your connection, then refresh."
    : cause === "the evidence names no current head" ? "The PR's current version is unavailable. Refresh to check again."
    : cause.startsWith("the PR is in ") ? "The Agent's PR belongs to another repository. Create a reaction for the correct PR."
    : cause === "receiver gone" ? "The original Agent is no longer available. Choose an available Agent for new work."
    : cause === "inbox" ? "The Agent's inbox is unavailable. Check the Agent before retrying."
    : cause === "not accepted" ? "The Agent did not accept this Message. Check the Agent before retrying."
    : cause === "merged" ? "Included in a newer summary."
    : cause.includes("unsupported") ? "This source cannot be watched. Stop this reaction and choose a supported condition."
    : "Observation details could not be explained. Refresh to check again.",
  reactionGap: (gap: string) => gap.startsWith("the Event history after ") ? "Earlier activity could not be read. This gap remains in the history." : (gap.startsWith("the Agent state was not read after Event ") || gap.startsWith("the Events after ")) ? "Agent activity could not be read. Nothing matched during that gap." : "Earlier observation details could not be explained.",
  reactionRecovery: (recovery: string) => recovery === "the recorded source gap remains; authoritative current Agent state reconciled observation" ? "Current Agent activity is available again; the earlier gap remains." : recovery === "stop this reaction and create one naming the Agents that exist" ? "Stop this reaction and create one with an available Agent." : "Refresh to check current observation.",
  reactionDetails: "Details",
  reactionFirings: reactionMax,
  reactionMax: reactionMax,
  reactionNoFirings: "None yet",
  reactionFiring: (ordinal: number, _message: number, outcome: string, matched: boolean) => `Firing ${ordinal} · ${reactionDelivery.get(outcome) ?? "Delivery unknown"}${matched ? "" : " · run by you"}`,
  reactionMessage: (_id: number) => "Message",
  reactionMessageState: "Delivery",
  reactionDelivery: (status: string) => reactionDelivery.get(status) ?? "Delivery unknown",
  reactionNotCreated: (cause: string) => `Reaction not created: ${cause}`,
  reactionCreationUnknown: (cause: string) => `Creation acceptance unknown. Check creation before saving another reaction. ${cause}`,
  reactionDate: "Date",
  reactionDatePlaceholder: "2026-10-21",
  reactionTime: shared.measurementTime,
  reactionTimePlaceholder: "09:00",
  reactionOffset: "UTC offset",
  reactionOffsetPlaceholder: "+01:00",
  reactionResolved: (preview: { at: string; utc: string; offset: string }) => `${preview.at}, ${preview.utc} UTC, offset ${preview.offset}`,
  reactionName: shared.name,
  reactionRepository: "Repository",
  reactionRepositoryPlaceholder: "owner/name",
  reactionPr: "PR number",
  reactionAt: "At",
  reactionPickTarget: "Pick an Agent",
  reactionKindAgents: "When these Agents finish",
  reactionKindPr: "When this PR's checks pass",
  reactionKindInstant: "At a time",
  reactionWatched: "Agents to watch",
  reactionAny: "Any one of them (otherwise all)",
  reactionRearm: "Re-arm after each firing",
  reactionPreview: "Preview",
  reactionPreviewActor: "Authorized by you, from the App",
  reactionIncomplete: "Not complete yet",
  reactionCheckCreation: "Check creation",
  reactionSave: "Save reaction",
} as const;

/** App-authored reactions copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

const reactionChanged = "The PR has changed.";

const reactionUnavailable = "Observation is unavailable. Refresh to check again.";

const delivered = "Delivered";

const sending = "Sending";

const reactionFiringStates = new Map([["pending", shared.draftStatus.pending], ["delivered", delivered], ["sending", sending], ["dropped", shared.askDropped], ["passed", "Forwarded"]]);

const reactionDelivery = new Map([["pending", shared.draftStatus.pending], ["delivered", delivered], ["dropped", "Not delivered"], ["sending", sending], ["passed", "Passed on"]]);

const reactionHealth = new Map([["fired", "It sent on time."], ["fired late", "It sent late."], ["expired: no firing at or after expires_at", "It expired before sending."], ["skipped: the instant was missed and the late policy is skip", "It missed the time and skipped as requested."], ["observing", "It is watching for changes."], ["not-observing", "It waits to start watching."], ["unavailable", reactionUnavailable], ["waiting", "It waits for checks."], ["matched", "The condition was met."], ["invalidated", reactionChanged], ["acceptance-failed", "Could not accept the firing; check again"], ["write-failed", "Could not save the firing; check again"], ["observation-save-failed", "Could not save observation; retry storage"]]);

const reactionStates = new Map([["stopped", "Stopped"], ["invalidated", "PR changed"], ["fired", "Sent on time"], ["fired late", "Sent late"], ["expired: no firing at or after expires_at", "Expired"], ["skipped: the instant was missed and the late policy is skip", "Missed; skipped"], ["observing", "Watching"], ["not-observing", "Awaiting observation"], ["unavailable", "Observation unavailable"], ["waiting", "Awaiting checks"], ["matched", "Condition met"], ["acceptance-failed", "Firing refused"], ["write-failed", "Firing save failed"], ["observation-save-failed", "Observation save failed"]]);

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
  reactionState: (state: string, health: string) => reactionStates.get(state === "active" ? health : state) ?? "Unavailable",
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
  reactionHealth: (health: string) => reactionHealth.get(health) ?? "Observation details could not be explained.",
  reactionDelivery: (status: string) => reactionDelivery.get(status) ?? "Delivery unknown",
  /** @prose */
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
    : cause === "merged" ? "A newer summary includes it."
    : cause.includes("unsupported") ? "This source cannot be watched. Stop this reaction and choose a supported condition."
    : "Observation details could not be explained. Refresh to check again.",
  reactionUnknownState: "Observation unclear",
  /** @prose */
  reactionUnknownEvidence: "Observation details could not be explained. Copy includes the original details.",
  reactionDetails: "Details",
  reactionObservation: "Observation",
  /** @prose */
  reactionGap: (gap: string) => gap.startsWith("the Event history after ") ? "Earlier activity could not be read. This gap remains in the history." : (gap.startsWith("the Agent state was not read after Event ") || gap.startsWith("the Events after ")) ? "Agent activity could not be read. No condition was met during that gap." : "Earlier observation details could not be explained.",
  /** @prose */
  reactionRecovery: (recovery: string) => recovery === "the recorded source gap remains; authoritative current Agent state reconciled observation" ? "Current Agent activity is available again; the earlier gap remains." : recovery === "stop this reaction and create one naming the Agents that exist" ? "Stop this reaction and create one with an available Agent." : "Refresh to check current observation.",
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

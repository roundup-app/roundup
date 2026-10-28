const railDraftStatuses = new Map([["draft", "Draft"], ["pending", "Submitting…"], ["unknown", "Completion unconfirmed"], ["failed", "Not submitted"]]);

const railDraftLabels = new Map([["rail-task", "Task"], ["rail-name", "Name"], ["rail-clear", "Clear reason"]]);

export const railDraftCopy = {
  addAgentWord: " Agent",
  railDraftTaskTarget: (name: string) => `Work for ${name}`,
  railDraftTaskAction: (send: boolean) => send ? "Send" : "Start Agent",
  railDraftUnknown: (project: string) => `A submission in ${project} may have completed. Its draft is kept; reopening does not retry it. Review the target before creating another request.`,
  railDraftBase: (name: string) => `Original name: ${name}`,
  railDraftDestination: (project: string, recipient: string) => `${project} · ${recipient}`,
  railDrafts: "Unfinished rail work",
  railDraftConflict: "The original name changed. Your edit is retained; copy or discard it before renaming again.",
  railDraftUnavailable: "The original target is unavailable. Copy or discard this draft.",
  railDraftRetention: (project: string, surface: string, operation: "restore" | "retain") => `${railDraftLabels.get(surface) ?? "Rail drafts"} in ${project}: ${operation === "restore" ? "stored work could not be restored" : "work could not be saved for reload"}. Keep this window open; copy your work or retry storage.`,
  railDraftRetry: "Retry storage",
  railDraftRecovery: (surface: string, object: string, status: string) => `${railDraftLabels.get(surface) ?? "Rail edit"} · ${object} · ${railDraftStatuses.get(status) ?? "Retained"}`,
  railDraftMissingTarget: "Unavailable target",
  railDraftRecovered: "Recovered rail draft",
  railDraftCopy: "Copy draft",
  railDraftDiscard: "Discard this revision",
} as const;

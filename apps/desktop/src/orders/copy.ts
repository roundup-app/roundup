/** App-authored orders copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";

const compactTokens = (value: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(value);

export const copy = {

  draftSurface: shared.draftSurface,
  draftStatus: shared.draftStatus,
  storageRetry: shared.storageRetry,
  discardRevision: shared.discardRevision,
  draftRetention: shared.draftRetention,
  copyField: shared.copyField,
  copyDraftFailure: shared.copyDraftFailure,
  openEvidence: shared.openEvidence,
  cancel: shared.cancel,
  error: shared.error,
  done: shared.done,
  title: shared.title,
  ask: shared.ask,
  save: shared.save,
  copied: shared.queryCopied,
  copyFailed: shared.copyFailed,
  clearName: shared.clearName,
  percent: shared.percent,
  context: "Context",
  contextUsed: "Used",
  contextOf: (used: number, limit: number) => `${compactTokens(used)} of ${compactTokens(limit)}`,
  contextValueText: (used: number, limit: number, percent: number) => `${compactTokens(used)}/${compactTokens(limit)} (${percent}%)`,
  contextNear: "near the limit",
  contextFull: "full",
  contextPart: { system: "System prompt", tools: shared.measurementTools, files: "Files", conversation: "Conversation", other: shared.measurementOther },
  contextExact: (label: string, tokens: number, share: number) => `${label}: ${new Intl.NumberFormat("en").format(tokens)} (${share}%)`,
  cardIntent: "Intent",
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- ConversationCard.shape is the domain term in GLOSSARY.md (A2681c).
  cardShape: "Shape",
  cardFacts: "Facts",
  cardOutcome: "Outcome",
  orderLimits: shared.orderLimits,
  progress: "Progress",
  /** @prose */
  progressUnreadable: (value1: CopyValue) => `Progress could not be read: ${value1}. Try reading again.`,
  progressRetry: "Read again",
  progressAccepted: "Accepted",
  progressChecked: "Checked independently",
  progressReceipt: "Confirmed by receipt",
  progressNotPerformed: "Receipt: not performed",
  progressChecksPending: "Check pending",
  progressUnknown: "Unknown outcome",
  progressUnavailable: "Evidence unavailable",
  progressOlder: "Older version",
  progressRemaining: "Remaining",
  progressEarlier: (value1: CopyValue) => `Earlier versions (${value1})`,
  resumeUnfinished: "Resume unfinished work",
  resumeRetry: "Try resuming again",
  resuming: "Resuming…",
  /** @prose */
  resumed: "Resumed: the Agent has the unfinished work.",
  /** @prose */
  resumeNothing: "No unfinished work to resume.",
  /** @prose */
  resumeFailed: (value1: CopyValue) => `${value1} The work is still unfinished.`,
  /** @prose */
  resumeUnknown: "Resume may have reached the Agent. It has to check before trying again.",
  /** @prose */
  thePromptCouldNotBeRead: "The prompt could not be read. Reopen it to try again.",
  /** @prose */
  theOrderCouldNotBeSaved: "The order could not be saved. Try saving again.",
  /** @prose */
  orderRestoreFailed: "This saved order form could not be restored. Recover unfinished work to copy or discard its original fields.",
  /** @prose */
  orderChanged: "The order has changed. Copy or discard your unfinished work.",
  doneWhen: "Done when",
  editOrder: "Edit order",
  notDone: "Not done",
  fullOrderOf: (value1: CopyValue) => `Order: ${value1}`,
  copySessionId: "Copy conversation id",
  orderOf: (value1: CopyValue) => `Order of ${value1}`,
  noLimits: "no limits",
  limit: "1 limit",
  limits: (value1: CopyValue) => `${value1} limits`,
  clarifying: (value1: CopyValue) => `Clarifying: ${value1}`,
  orderWithLimits: shared.riskLine,
} as const;

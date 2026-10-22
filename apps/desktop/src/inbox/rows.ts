import type { Decision } from "@contracts/decision/Decision";
import type { RailNode } from "@contracts/agent/RailNode";
import { copy } from "../copy";
import { questionOf } from "../decisions/AskCard";
import { attentionOrder } from "../rail/attention";

/** One answer a Decision row offers without expanding: `word` is what `decision.answer` carries. */
export type Quick = { label: string; word: string; confirmation: string };

/** U3770b: Approve and Reject for a permission Decision, the first two answers of an ask; `null` when the Decision needs its card. */
export const quickAnswers = (decision: Decision): readonly Quick[] | null => {
  if (!decision.answerable) return null;

  if (decision.tool !== "ask_user") {
    return [
      { label: copy.inboxApprove, word: "allow", confirmation: copy.inboxApproved },
      { label: copy.inboxReject, word: "deny", confirmation: copy.inboxRejected },
    ];
  }

  const answers = questionOf(decision.args)?.answers.slice(0, 2) ?? [];

  return answers.length === 0 ? null : answers.map(({ label }) => ({ label, word: label, confirmation: copy.inboxAnswered(label) }));
};

/** U3770a: the Agents of each section, in the order the section shows them. */
export const sectionsOf = (nodes: readonly RailNode[]) => ({
  needs: attentionOrder(nodes),
  running: nodes.filter((node) => node.kind === "agent" && node.status?.kind === "working"),
  done: nodes.filter((node) => node.kind === "agent" && node.status?.kind === "done").toSorted((a, b) => b.status!.since - a.status!.since),
});

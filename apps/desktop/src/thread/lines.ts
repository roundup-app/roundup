import { copy } from "../copy";
import type { Message } from "@contracts/message/Message";

const FOLDED_CHARS = 60;

/** U106: a Message between two Agents; one to or from the user, or to a node the Rail does not show, is never folded. */
export const isBetweenAgents = (message: Message, nodeIds: ReadonlySet<string>): boolean =>
  message.from.kind === "agent" && nodeIds.has(message.to);

/** U189: only a `question` from an Agent to the user is a Card; a `note` to the user is a plain body in its run. */
export const isCard = (message: Message): boolean => message.from.kind === "agent" && message.to === "you" && message.kind === "question";

/** U189: the first 60 characters of a body with line breaks read as spaces, and `…` only where the body goes on. */
export const foldedBody = (body: string): string => {
  const head = body.replace(/\s/g, " ").slice(0, FOLDED_CHARS);

  return body.length > FOLDED_CHARS ? copy.foldedText(head) : head;
};

/** U189: a folded body is a button only where opening it shows more: a cut, or a line break the fold read as a space. */
export const hasMore = (body: string): boolean => body.length > FOLDED_CHARS || /[\r\n\t]/.test(body);

/** U189: `HH:MM` of `at` in the local zone. */
export const clock = (at: number): string => {
  const time = new Date(at);

  return copy.time(String(time.getHours()).padStart(2, "0"), String(time.getMinutes()).padStart(2, "0"));
};

const DROPPED: Record<NonNullable<Message["reason"]>, string> = {
  "ask-first": copy.itNeededApproval,
  takeover: copy.aTakeoverWasUnderWay,
  escalated: copy.itWasNotAnswered,
  "receiver gone": copy.theReceiverIsGone,
  "not accepted": copy.theReceiverDidNotAcceptIt,
  passed: copy.itWasPassedOn,
  merged: copy.itWasMergedIntoAnother,
};

/** U354: a status in plain words with what the user can do, or null where it is the expected `delivered`. */
export const statusText = (message: Pick<Message, "status" | "reason">): string | null => {
  if (message.status === "delivered") return null;

  if (message.status === "held") {
    if (message.reason === "escalated") return copy.waitingForYouAnswerBelow;

    if (message.reason === "takeover") return copy.waitingUntilTheTakeoverEnds;

    return copy.waitingForApproval;
  }

  if (message.status === "dropped") return message.reason === null ? copy.notDelivered : copy.notDeliveredReason(DROPPED[message.reason]);

  return copy.pending;
};

/** U422: the first sentence of an order: up to the first `. `, `? `, `! ` or line break, else all of it. */
export const firstSentence = (text: string): string => {
  const flat = text.trim();
  const end = flat.search(/[.?!](\s|$)|\n/);

  if (end === -1) return flat;

  return flat[end] === "\n" ? flat.slice(0, end).trim() : flat.slice(0, end + 1);
};

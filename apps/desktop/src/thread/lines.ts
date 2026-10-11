import type { Order } from "@contracts/agent/Order";
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

  return body.length > FOLDED_CHARS ? `${head}…` : head;
};

/** U189: a folded body is a button only where opening it shows more: a cut, or a line break the fold read as a space. */
export const hasMore = (body: string): boolean => body.length > FOLDED_CHARS || /[\r\n\t]/.test(body);

/** U189: `HH:MM` of `at` in the local zone. */
export const clock = (at: number): string => {
  const time = new Date(at);

  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
};

const DROPPED: Record<NonNullable<Message["reason"]>, string> = {
  "ask-first": "it needed approval",
  takeover: "a takeover was under way",
  escalated: "it was not answered",
  "receiver gone": "the receiver is gone",
  "not accepted": "the receiver did not accept it",
  passed: "it was passed on",
  merged: "it was merged into another",
};

/** U354: a status in plain words with what the user can do, or null where it is the expected `delivered`. */
export const statusText = (message: Pick<Message, "status" | "reason">): string | null => {
  if (message.status === "delivered") return null;

  if (message.status === "held") {
    if (message.reason === "escalated") return "waiting for you: answer below";

    if (message.reason === "takeover") return "waiting until the takeover ends";

    return "waiting for approval";
  }

  if (message.status === "dropped") return message.reason === null ? "not delivered" : `not delivered: ${DROPPED[message.reason]}`;

  return message.status;
};

/** U197: what the header says under the ask, in Q5's words. */
export const limitsText = (order: Order): string => {
  if (order.kind === "clarification") return `clarifying: ${order.question}`;

  const count = order.limits.length;

  return count === 0 ? "no limits" : count === 1 ? "1 limit" : `${count} limits`;
};

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
  "ask-first": "It needed approval",
  takeover: "A Takeover was under way",
  escalated: "It was not answered",
  "receiver gone": "The receiver is gone",
  "not accepted": "The receiver did not accept it",
  passed: "It was passed on",
  merged: "It was merged into another",
};

/** U354: a status in plain words with what the user can do, or null where it is the expected `delivered`. */
export const statusText = (message: Pick<Message, "status" | "reason">): string | null => {
  if (message.status === "delivered") return null;

  if (message.status === "held") {
    if (message.reason === "escalated") return "Waiting for you: Answer below";

    if (message.reason === "takeover") return "Waiting until the Takeover ends";

    return "Waiting for approval";
  }

  if (message.status === "dropped") return message.reason === null ? "Not delivered" : `Not delivered: ${DROPPED[message.reason]}`;

  return "Pending";
};

/** U422: the first sentence of an order: up to the first `. `, `? `, `! ` or line break, else all of it. */
export const firstSentence = (text: string): string => {
  const flat = text.trim();
  const end = flat.search(/[.?!](\s|$)|\n/);

  if (end === -1) return flat;

  return flat[end] === "\n" ? flat.slice(0, end).trim() : flat.slice(0, end + 1);
};

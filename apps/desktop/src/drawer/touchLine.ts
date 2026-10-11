import type { Actor } from "@contracts/Actor";
import type { Touch } from "@contracts/Touch";

const twoDigits = (value: number): string => String(value).padStart(2, "0");

/** `last  <name> <read|wrote> <hh:mm>` for the newest Touch, in local time; `null` when the item was never touched. */
export const lastTouchLine = (history: readonly Touch[], nameOf: (actor: Actor) => string): string | null => {
  const newest = history.reduce<Touch | null>(
    (best, touch) => (best === null || touch.at >= best.at ? touch : best),
    null,
  );

  if (newest === null) return null;

  const at = new Date(newest.at);

  return `last  ${nameOf(newest.actor)} ${newest.verb} ${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
};

/** U190: `<name> <read|wrote> this pad at <time>` for a Pad's newest Touch, the time in the user's locale; `null` when it was never touched. */
export const padTouchSentence = (history: readonly Touch[], nameOf: (actor: Actor) => string): string | null => {
  const newest = history.reduce<Touch | null>(
    (best, touch) => (best === null || touch.at >= best.at ? touch : best),
    null,
  );

  if (newest === null) return null;

  const time = new Date(newest.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return `${nameOf(newest.actor)} ${newest.verb} this pad at ${time}`;
};

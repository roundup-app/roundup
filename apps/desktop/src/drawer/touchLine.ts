import { clockTime, copy } from "./copy";
import type { Actor } from "@contracts/Actor";
import type { Touch } from "@contracts/Touch";

/** `<name> <read|wrote> · <hh:mm>` for the newest Touch, in local time; `null` when the item was never touched. */
export const lastTouchLine = (history: readonly Touch[], nameOf: (actor: Actor) => string): string | null => {
  const newest = history.reduce<Touch | null>(
    (best, touch) => (best === null || touch.at >= best.at ? touch : best),
    null,
  );

  if (newest === null) return null;

  const time = clockTime.format(new Date(newest.at));

  return copy.lastTouch(nameOf(newest.actor), newest.verb, time);
};

/** U190: `<name> <read|wrote> · <time>` for a Pad's newest Touch, the time in the user's locale; `null` when it was never touched. */
export const padTouchSentence = (history: readonly Touch[], nameOf: (actor: Actor) => string): string | null => {
  const newest = history.reduce<Touch | null>(
    (best, touch) => (best === null || touch.at >= best.at ? touch : best),
    null,
  );

  if (newest === null) return null;

  const time = new Date(newest.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return copy.padTouch(newest.actor.kind === "user" ? copy.you : nameOf(newest.actor), newest.verb, time);
};

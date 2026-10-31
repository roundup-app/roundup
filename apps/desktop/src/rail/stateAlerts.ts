import type { Kind } from "@contracts/Kind";
import type { StateAlert } from "../app/seam";
import { appSettings } from "../settings/preferences";
import { stateLabel } from "../settings/copy";

/** U5232d: per Agent, at most one alert and one sound in this many milliseconds. */
const WINDOW_MS = 5000;

export type StateAlerts = {
  /** U5232c: an Agent's Kind just changed. Calls `stateAlert` as the owner chose and answers whether the Toast of `needs-you` and `error` sounds its chime, which that Toast alone plays. */
  changed(agent: { key: string; id: string; name: string; kind: Kind; selected: boolean }): { chime: boolean };
};

/** The Alert and Sound choices of U5232. `onFailure` gets the cause of a refused call, or null after one that worked. */
export const createStateAlerts = (
  send: (alert: StateAlert) => Promise<void>,
  inFront: () => boolean,
  onFailure: (message: string | null) => void,
  now: () => number = Date.now,
): StateAlerts => {
  const last = new Map<string, number>();

  return {
    changed: ({ key, id, name, kind, selected }) => {
      const none = { chime: false };

      if (kind === "idle") return none;

      const front = inFront();
      const choice = appSettings().stateAlerts[kind];
      const alert = choice.alert && !front;
      const sound = choice.sound;

      if (!alert && !sound) return none;

      if (front && selected) return none;

      const at = now();
      const before = last.get(key);

      if (before !== undefined && at - before < WINDOW_MS) return none;

      last.set(key, at);

      const toast = kind === "needs-you" || kind === "error";

      if (alert || (sound && !toast)) {
        send({ agent: id, title: name, body: stateLabel(kind), alert, sound: sound && !toast }).then(
          () => onFailure(null),
          (failure: unknown) => {
            if (!(failure instanceof Error)) throw failure;

            onFailure(failure.message);
          },
        );
      }

      return { chime: sound && toast };
    },
  };
};

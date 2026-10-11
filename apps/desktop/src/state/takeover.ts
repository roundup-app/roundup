import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { Events } from "../app/events";
import type { AppSeam, DaemonExit } from "../app/seam";

/** The one Takeover the user holds (B6, U107): who is taken, and the calls that begin and end it. Each call answers its failure text, or `null`. */
export type TakeoverState = {
  /** The Agent the user types into directly; `null` when none, and always `null` once the Daemon has ended (B8). */
  taken: Accessor<string | null>;
  /** Ends any other Takeover first, then begins this one. */
  begin(agent: string): Promise<string | null>;
  /** Ends the Takeover of `agent`, or of whoever is taken when `agent` is omitted; nothing to end is not a failure. */
  end(agent?: string): Promise<string | null>;
  /** U187: a reloaded webview cannot list a live Takeover, so the first time a Door shows it ends one it may hold; the answer is ignored. */
  release(agent: string): Promise<void>;
};

export const createTakeover = (app: AppSeam, events: Events, daemonExit: Accessor<DaemonExit | null>): TakeoverState => {
  const [raw, setRaw] = createSignal<string | null>(null);
  const released = new Set<string>();
  let last: Promise<unknown> = Promise.resolve();

  // A Takeover ends by itself when its Agent exits (B6): the Daemon's word is the truth.
  events.subscribe((event) => {
    if (event.name !== "takeover.changed") return;

    if (event.data.on) setRaw(event.data.agent);
    else if (raw() === event.data.agent) setRaw(null);
  });

  /** A queue, so two quick calls end one Takeover before the next begins. */
  const queue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = last.then(job);

    last = run.catch(() => undefined);

    return run;
  };

  const call = async (method: "takeover.begin" | "takeover.end", agent: string): Promise<string | null> => {
    if (daemonExit() !== null) return null;

    try {
      await app.rpc(method, { agent });
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return error.message;
    }

    setRaw(method === "takeover.begin" ? agent : null);

    return null;
  };

  const endNow = async (agent?: string): Promise<string | null> => {
    const current = raw();

    if (current === null || (agent !== undefined && agent !== current)) return null;

    return call("takeover.end", current);
  };

  return {
    taken: () => (daemonExit() === null ? raw() : null),
    begin: (agent) =>
      queue(async () => {
        if (raw() === agent) return null;

        const failure = await endNow();

        return failure ?? call("takeover.begin", agent);
      }),
    end: (agent) => queue(() => endNow(agent)),
    release: (agent) =>
      queue(async () => {
        if (released.has(agent) || daemonExit() !== null) return;

        released.add(agent);
        await app.rpc("takeover.end", { agent }).catch(() => undefined);
      }),
  };
};

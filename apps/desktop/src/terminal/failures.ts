import { createSignal } from "solid-js";
import { coreFailureText } from "./coreFailure";

type FailureEntry = { message: string; order: number; retry: (() => void) | null };

/** `output` is the subscription's own failure: a later successful call does not clear it, only a new subscription does. */
type TerminalFailures = { snapshot: FailureEntry | null; live: FailureEntry | null; output: FailureEntry | null; clipboard: FailureEntry | null; link: FailureEntry | null };

export type FailureKind = keyof TerminalFailures;

const FAILURE_KINDS = ["snapshot", "live", "output", "clipboard", "link"] as const;

const newestFailure = (state: TerminalFailures | undefined): FailureEntry | null => {
  if (!state) return null;

  return Object.values(state).reduce<FailureEntry | null>(
    (latest, entry) => entry && (!latest || entry.order > latest.order) ? entry : latest,
    null,
  );
};

export type Failures = {
  set(id: string, kind: FailureKind, message: string | null, retry?: (() => void) | null): void;
  /** The failure `failure(id)` shows, with the Terminal that owns it: that of `id`, or with no `id` the newest of any Terminal. */
  shown(id: string | null): { id: string; entry: FailureEntry } | null;
  /** P3557c: the user dismisses the shown failure of `id`; an older failure of that Terminal then shows. */
  dismiss(id: string | null): void;
  /** Awaits a Terminal's call: success clears its `live` failure, an error becomes it. */
  attempt(id: string, call: Promise<unknown>): Promise<boolean>;
};

/** U6249b, P3557c: each Terminal's failures. One stays until a later success or a dismiss. */
export const createFailures = (): Failures => {
  const [failures, setFailures] = createSignal(new Map<string, TerminalFailures>());
  let order = 0;

  const set: Failures["set"] = (id, kind, message, retry = null) => {
    setFailures((current) => {
      const previous = current.get(id) ?? { snapshot: null, live: null, output: null, clipboard: null, link: null };

      if (message === null && previous[kind] === null) return current;

      const state: TerminalFailures = { ...previous };

      if (message !== null && (kind === "live" || kind === "link")) {
        state.live = null;
        state.link = null;
      }

      state[kind] = message === null ? null : { message: coreFailureText(message), order: ++order, retry };

      const next = new Map(current);

      // One Terminal scope per Project: replacing a kind also replaces its owned Terminal.
      // Acknowledgments still clear only their original id and operation.
      if (message !== null) for (const [otherId, other] of next) {
        const replaced = { ...other };
        const sameKind = kind === "live" || kind === "link" ? ["live", "link"] as const : [kind];

        for (const operation of sameKind) replaced[operation] = null;

        if (newestFailure(replaced)) next.set(otherId, replaced);
        else next.delete(otherId);
      }

      next.delete(id);

      if (newestFailure(state)) next.set(id, state);

      return next;
    });
  };

  const shown: Failures["shown"] = (id) => {
    let latest: { id: string; entry: FailureEntry } | null = null;

    for (const [owner, state] of failures()) {
      const entry = id === null || owner === id ? newestFailure(state) : null;

      if (entry && (!latest || entry.order > latest.entry.order)) latest = { id: owner, entry };
    }

    return latest;
  };

  const attempt: Failures["attempt"] = async (id, call) => {
    try {
      await call;

      set(id, "live", null);

      return true;
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      set(id, "live", thrown.message);

      return false;
    }
  };

  return {
    attempt,
    set,
    shown,
    dismiss: (id) => {
      const top = shown(id);
      const state = top && failures().get(top.id);

      if (top) for (const kind of FAILURE_KINDS) if (state?.[kind] === top.entry) set(top.id, kind, null);
    },
  };
};

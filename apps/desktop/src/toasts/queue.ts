import { createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { Kind } from "@contracts/Kind";
import type { Chime } from "./chime";

/** U411: how long a Toast stays, and U414: how long it takes to leave. */
const TOAST_MS = 5000;

const LEAVE_MS = 150;

const MOST_SHOWN = 3;

const CHIME_GAP_MS = 1000;

/** What an event of U410 asks for. `key` is the acting Agent, so its repeats replace its Toast; `open` answers a failure line, or `null`. */
export type Candidate = {
  key: string;
  kind: Kind;
  name: string;
  line: string;
  /** U413: this event is for the Agent the user has selected. */
  selected: boolean;
  open: () => Promise<string | null> | string | null;
};

type Entry = Candidate & { id: number; leaving: boolean };

export type ToastView = { more: false; id: number; kind: Kind; name: string; line: string; leaving: boolean } | { more: true; id: -1; count: number };

export type ToastQueue = {
  views: Accessor<readonly ToastView[]>;
  /** U80's one failure line: no timer; the next Toast click or push clears it. */
  failure: Accessor<string | null>;
  push(candidate: Candidate): void;
  /** Hover or focus (`true`) stops the Toast's timer; the end of both restarts the full time. */
  hold(id: number, held: boolean): void;
  dismiss(id: number): void;
  activate(id: number): Promise<void>;
};

/** U410 to U414. The timers, the held Toasts and the one-per-second sound live here; with nothing pushed, nothing runs. */
export const createToastQueue = (inFront: () => boolean, chime: Chime, reducedMotion: Accessor<boolean>, now: () => number = Date.now): ToastQueue => {
  const [entries, setEntries] = createSignal<readonly Entry[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const held = new Map<string, Candidate>();
  let lastChime = Number.NEGATIVE_INFINITY;
  let next = 0;
  let listening = false;

  const clear = (id: number) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  };

  const remove = (id: number) => {
    clear(id);
    setEntries((all) => all.filter((entry) => entry.id !== id));
  };

  const dismiss = (id: number) => {
    clear(id);

    if (reducedMotion()) return remove(id);

    setEntries((all) => all.map((entry) => (entry.id === id ? { ...entry, leaving: true } : entry)));
    timers.set(id, setTimeout(() => remove(id), LEAVE_MS));
  };

  const start = (id: number) => {
    clear(id);
    timers.set(id, setTimeout(() => dismiss(id), TOAST_MS));
  };

  const show = (candidate: Candidate) => {
    const old = entries().find((entry) => entry.key === candidate.key);

    if (old) clear(old.id);

    const id = (next += 1);

    setEntries((all) => [{ ...candidate, id, leaving: false }, ...all.filter((entry) => entry.key !== candidate.key)]);
    start(id);
  };

  const comeBack = () => {
    if (!inFront()) return;

    stopListening();

    const waiting = [...held.values()];

    held.clear();
    waiting.forEach(show);
  };

  const stopListening = () => {
    listening = false;
    window.removeEventListener("focus", comeBack);
    document.removeEventListener("visibilitychange", comeBack);
  };

  const listenForReturn = () => {
    if (listening) return;

    listening = true;
    window.addEventListener("focus", comeBack);
    document.addEventListener("visibilitychange", comeBack);
  };

  const sound = () => {
    const at = now();

    if (at - lastChime < CHIME_GAP_MS) return;

    lastChime = at;
    chime();
  };

  onCleanup(() => {
    stopListening();
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
  });

  const views = createMemo<readonly ToastView[]>(() => {
    const all = entries();
    const view = (entry: Entry): ToastView => ({ more: false, id: entry.id, kind: entry.kind, name: entry.name, line: entry.line, leaving: entry.leaving });

    return all.length <= MOST_SHOWN ? all.map(view) : [...all.slice(0, MOST_SHOWN - 1).map(view), { more: true, id: -1, count: all.length - (MOST_SHOWN - 1) }];
  });

  return {
    views,
    failure,
    push: (candidate) => {
      setFailure(null);

      if (inFront()) {
        if (candidate.selected) return;

        show(candidate);
      } else {
        held.set(candidate.key, candidate);
        listenForReturn();
      }

      sound();
    },
    hold: (id, isHeld) => {
      const entry = entries().find((each) => each.id === id);

      if (!entry || entry.leaving) return;

      if (isHeld) clear(id);
      else start(id);
    },
    dismiss,
    activate: async (id) => {
      const entry = entries().find((each) => each.id === id);

      if (!entry) return;

      dismiss(id);
      setFailure(null);

      const message = await entry.open();

      setFailure(message);
    },
  };
};

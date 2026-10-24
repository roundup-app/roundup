import { ReservedLine } from "../ink/ReservedLine";
import type { ActivationSource } from "../keys/registry";
import { createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { Kind } from "@contracts/Kind";
import { copy } from "../copy";
import { createToast } from "../ui/Toast";
import { KindGlyph } from "../ink/KindGlyph";
import type { Chime } from "./chime";

const MOST_SHOWN = 3;

const CHIME_GAP_MS = 1000;

/** P3557c: a failure about an item has no time; it leaves when the item is deleted or saved, or the user closes it. */
const NO_TIME = Number.POSITIVE_INFINITY;

/** The failure line's card identity; like the summary, no Candidate owns it. */
const FAILURE = "failure";

/** The summary card's identity; it is the one Toast no Candidate owns. */
const MORE = "more";

/** What an event of U410 asks for. `key` is the acting Agent, so its repeats replace its Toast; `open` answers a failure line, or `null`. */
export type Candidate = {
  key: string;
  /** P3557c: the item a failure of `open` is about, such as `todo:7`; the same item opening again, deleted or saved clears that failure. */
  item: string;
  kind: Kind;
  name: string;
  line: string;
  /** U413: this event is for the Agent the user has selected. */
  selected: boolean;
  open: (source: ActivationSource) => Promise<string | null> | string | null;
};

type Entry = Candidate & { id: string };

export type ToastQueue = {
  /** The shared Toast the layer renders; Ark owns every card's lifetime, hover and focus pausing. */
  toast: ReturnType<typeof createToast>;
  /** How many cards show, so the layer re-measures only when they change. */
  shown: Accessor<number>;
  /** U80's one failure line: a card of its own with no time; P3557c clears it with its item. */
  failure: Accessor<string | null>;
  /** P3557c: the item was deleted or saved; its failure, and no other, clears. */
  settle(item: string): void;
  push(candidate: Candidate): void;
  /** A Toast for something the user just did; it makes no sound and is never suppressed for the selected Agent. */
  notify(candidate: Candidate): void;
};

/** U410 to U414. Event policy lives here: queued Toasts while away, coalescing by Agent, the summary card and the one-per-second sound. Lifetimes belong to the shared Toast; with nothing pushed, nothing runs. */
export const createToastQueue = (inFront: () => boolean, chime: Chime, now: () => number = Date.now): ToastQueue => {
  const [entries, setEntries] = createSignal<readonly Entry[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  let failedItem: string | null = null;
  const held = new Map<string, Candidate>();
  // Entries whose card is closing stay findable until the next push, for the activation that closed them.
  const known = new Map<string, Entry>();
  const displayed = new Set<string>();
  let lastChime = Number.NEGATIVE_INFINITY;
  let next = 0;
  let listening = false;

  const toast = createToast({
    limit: MOST_SHOWN,
    newestFirst: true,
    onDismiss: (id) => {
      if (id === FAILURE) {
        failedItem = null;
        setFailure(null);

        return;
      }

      displayed.delete(id);

      if (id === MORE) setEntries((all) => all.slice(0, MOST_SHOWN - 1));
      else setEntries((all) => all.filter((entry) => entry.id !== id));

      sync();
    },
    onActivate: (id, source) => {
      if (id === MORE || id === FAILURE) return;

      const entry = known.get(id);

      if (!entry) return;

      void Promise.resolve(entry.open(source)).then((message) => {
        if (message === null) settle(entry.item);
        else showFailure(message, entry.item);
      });
    },
  });

  function clearFailure() {
    if (failure() === null) return;

    failedItem = null;
    setFailure(null);
    toast.store.remove(FAILURE);
  }

  function settle(item: string) {
    if (failedItem === item) clearFailure();
  }

  /** A new line replaces the old one. */
  function showFailure(message: string, item: string) {
    clearFailure();
    failedItem = item;
    setFailure(message);
    toast.show({ id: FAILURE, name: "", content: "", body: () => <ReservedLine message={message}><button type="button" data-button="quiet" onClick={() => toast.dismiss(FAILURE)}>{copy.close}</button></ReservedLine>, duration: NO_TIME, extra: true });
  }

  const shown = createMemo(() => Math.min(entries().length, MOST_SHOWN));

  /** Shows the newest two Entries and, past three, one summary card standing for the rest. The summary is the oldest card, so it rests last. */
  function sync() {
    const all = entries();
    const hidden = all.length > MOST_SHOWN ? all.length - (MOST_SHOWN - 1) : 0;
    const cards = hidden > 0 ? all.slice(0, MOST_SHOWN - 1) : all;

    if (hidden > 0 && !displayed.has(MORE)) {
      for (const entry of cards) if (displayed.delete(entry.id)) toast.store.remove(entry.id);
    }

    if (hidden > 0) {
      toast.show({ id: MORE, name: "", content: copy.toastOverflow(hidden) });
      displayed.add(MORE);
    } else if (displayed.delete(MORE)) toast.store.remove(MORE);

    for (const entry of [...cards].reverse()) {
      if (displayed.has(entry.id)) continue;

      displayed.add(entry.id);
      toast.show({ id: entry.id, label: entry.name === "" ? entry.line : copy.toastLine(entry.name, entry.line), glyph: <KindGlyph kind={entry.kind} decorative />, name: entry.name, content: entry.line });
    }
  }

  const show = (candidate: Candidate) => {
    const old = entries().find((entry) => entry.key === candidate.key);

    if (old && displayed.delete(old.id)) toast.store.remove(old.id);

    for (const id of known.keys()) if (!entries().some((entry) => entry.id === id)) known.delete(id);

    next += 1;

    const entry = { ...candidate, id: String(next) };

    known.set(entry.id, entry);
    setEntries((all) => [entry, ...all.filter((each) => each.key !== candidate.key)]);
    sync();
  };

  const comeBack = () => {
    if (!inFront()) return;

    stopListening();

    const waiting = [...kept.values()];

    kept.clear();
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

  onCleanup(stopListening);

  return {
    toast,
    shown,
    failure,
    settle,
    notify: (candidate) => {
      show(candidate);
    },
    push: (candidate) => {
      if (inFront()) {
        if (candidate.selected) return;

        show(candidate);
      } else {
        kept.set(candidate.key, candidate);
        listenForReturn();
      }

      sound();
    },
  };
};

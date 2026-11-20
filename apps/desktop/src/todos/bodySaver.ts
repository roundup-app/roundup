import { debounce } from "@solid-primitives/scheduled";
import { runWithOwner } from "solid-js";
import { applying, SAVE_PAUSE_MS, type Applied } from "../app/pending";
import type { Sent } from "../state/draftField";
import { copy } from "./copy";

/** What the saves of one edit (its `form`) have done to the change it expects, and whether one is still being acknowledged. */
export type Saving = { of: object; expected: number | null; busy: boolean };

type Draft = {
  save: () => void;
  send: (call: () => Promise<Applied<void>>) => Promise<Sent<void>>;
  draft: () => { status: string } | undefined;
  retained: () => Promise<object | null>;
  discard: () => Promise<object | null>;
};

/**
 * A body saves as the user types (U7641a): a pause in the typing saves it, one save at a time, a change made while one
 * runs goes in the next, so the Daemon ends with the last text; each acknowledged save moves the expected change to the one it made.
 */
export const createBodySaver = (config: {
  form: { base: string; expected_change: number | null };
  read: () => string;
  props: { commit: (text: string, expectedChange: number) => Promise<void>; latest?: (() => Promise<number | null>) | undefined; onSaved?: (() => void) | undefined };
  draft: Draft;
  retain: () => void;
  open: () => boolean;
  alive: () => boolean;
  /** The failure line: a message, or null once a save lands. */
  report: (message: string | null) => void;
  /** Each move of the saves: its own changes are not changes made elsewhere. */
  track: (saving: Saving) => void;
  /** The edit began from a recovered draft, which Esc keeps. */
  recovered: boolean;
}) => {
  const { form, read, props, draft, retain, open, alive, report, track, recovered } = config;
  let saved = form.base;
  let expected = form.expected_change;
  let inflight: Promise<void> | undefined;
  let dirty = false;
  /** The text a save last failed with: the same text is not sent again, so its failure stays until the user changes it. */
  let unsent: string | undefined;

  const landed = () => { report(null); props.onSaved?.(); };

  const run = async (): Promise<void> => {
    if (!open() || !alive() || expected === null) return;

    if (inflight) {
      dirty = true;

      return;
    }

    const value = read();
    const was = expected;

    if (value === saved || value === unsent) return;

    track({ of: form, expected, busy: true });
    inflight = (async () => {
      retain();
      draft.save();
      const sent = await draft.send(() => applying(() => props.commit(value, was)));

      if (!alive()) return;

      unsent = sent.kind === "applied" ? undefined : value;

      if (sent.kind === "applied") {
        saved = value;
        landed();
        expected = (await props.latest?.().catch(() => null)) ?? expected;
      } else if (sent.kind === "refused" || sent.kind === "unknown") report(sent.kind === "refused" ? sent.error.message : copy.draftStatus.unknown);
    })();

    await inflight;
    inflight = undefined;

    if (dirty) {
      dirty = false;
      await run();
    }

    track({ of: form, expected, busy: inflight !== undefined });
  };

  // An editor binds inside an effect, which allows no cleanup; `alive` and `open` end a pause that outlives the edit.
  const pause = runWithOwner(null, () => debounce(() => void run(), SAVE_PAUSE_MS));

  /** Esc drops the text kept since the last save, so cancelled text never comes back; if the Project could not retain it, that draft is the only copy left (P11). */
  const abandon = async () => {
    if (recovered || draft.draft()?.status !== "draft") return;

    if (await draft.retained() === null) await draft.discard();
  };

  /** Esc: puts back the body as the edit found it, and saves that; the text typed since the last save is dropped with its draft, and an autosave consumed its own, so this goes straight to the Daemon. */
  const revert = async () => {
    pause.clear();
    await inflight;
    void abandon();
    const was = expected;

    if (saved === form.base || was === null || !alive()) return;
    const sent = await applying(() => props.commit(form.base, was));

    if (!alive()) return;

    if (sent.kind === "applied") landed();
    else report(sent.kind === "refused" ? sent.error.message : copy.draftStatus.unknown);
  };

  return {
    /** A change: it saves once the typing pauses. */
    schedule: pause,
    revert,
    /** What the Daemon holds and the change it expects, once any save in flight has settled. */
    settled: async () => {
      pause.clear();
      await inflight;

      return { saved, expected };
    },
  };
};

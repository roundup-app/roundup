import { applying, type Applied } from "../app/pending";
import type { Sent } from "../state/draftField";
import { copy } from "./copy";

/** What the saves of one edit (its `form`) have done to the change it expects, and whether one is still being acknowledged. */
export type Saving = { of: object; expected: number | null; busy: boolean };

type Draft = { save: () => void; send: (call: () => Promise<Applied<void>>) => Promise<Sent<void>> };

const pause = 600;

/**
 * A body saves as the user types (U7641a): one save at a time, a change made while one runs goes in the next, so the
 * Daemon ends with the last text; each acknowledged save moves the expected change to the one it made.
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
}) => {
  const { form, read, props, draft, retain, open, alive, report, track } = config;
  let saved = form.base;
  let expected = form.expected_change;
  let inflight: Promise<void> | undefined;
  let dirty = false;
  /** The text a save last failed with: the same text is not sent again, so its failure stays until the user changes it. */
  let unsent: string | undefined;

  const landed = () => { report(null); props.onSaved?.(); };

  const run = async (force = false): Promise<void> => {
    if ((!force && !open()) || expected === null) return;

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
      await run(force);
    }

    track({ of: form, expected, busy: inflight !== undefined });
  };

  /** Esc: puts back the body as the edit found it, and saves that; an autosave consumed its draft, so this goes straight to the Daemon. */
  const revert = async () => {
    cancel();
    await inflight;
    const was = expected;

    if (saved === form.base || was === null || !alive()) return;
    const sent = await applying(() => props.commit(form.base, was));

    if (!alive()) return;

    if (sent.kind === "applied") landed();
    else report(sent.kind === "refused" ? sent.error.message : copy.draftStatus.unknown);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };

  return {
    /** A change waits for a pause in typing, so one burst is one save and one history entry. */
    run: () => { cancel(); timer = setTimeout(() => { timer = undefined; void run(); }, pause); },
    revert,
    /** What the Daemon holds and the change it expects, once any save in flight has settled. */
    settled: async () => {
      if (timer !== undefined) { cancel(); await run(true); }

      await inflight;

      return { saved, expected };
    },
  };
};

import { applying, type Applied } from "../app/pending";
import type { Sent } from "../state/draftField";
import { copy } from "./copy";

type Draft = { save: () => void; send: (call: () => Promise<Applied<void>>) => Promise<Sent<void>> };

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
}) => {
  const { form, read, props, draft, retain, open, alive, report } = config;
  let saved = form.base;
  let expected = form.expected_change;
  let inflight: Promise<void> | undefined;
  let dirty = false;

  const landed = () => { report(null); props.onSaved?.(); };

  const run = async (): Promise<void> => {
    if (!open() || expected === null) return;

    if (inflight) {
      dirty = true;

      return;
    }

    const value = read();
    const was = expected;

    if (value === saved) return;

    inflight = (async () => {
      retain();
      draft.save();
      const sent = await draft.send(() => applying(() => props.commit(value, was)));

      if (!alive()) return;

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
  };

  /** Esc: puts back the body as the edit found it, and saves that; an autosave consumed its draft, so this goes straight to the Daemon. */
  const revert = async () => {
    await inflight;
    const was = expected;

    if (saved === form.base || was === null || !alive()) return;
    const sent = await applying(() => props.commit(form.base, was));

    if (!alive()) return;

    if (sent.kind === "applied") landed();
    else report(sent.kind === "refused" ? sent.error.message : copy.draftStatus.unknown);
  };

  return {
    run,
    revert,
    /** What the Daemon holds and the change it expects, once any save in flight has settled. */
    settled: async () => {
      await inflight;

      return { saved, expected };
    },
  };
};

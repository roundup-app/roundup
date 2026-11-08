import { batch, createSignal, type Accessor } from "solid-js";
import { createItemFailures } from "../ink/itemFailures";

export type BubbleTerminal = { id: string; incarnation: string };

export type BubbleFailure = { message: string; terminal: BubbleTerminal | null };

const keyOf = (terminal: BubbleTerminal): string => `${terminal.id}:${terminal.incarnation}`;

/** P3557c: a draft's copy failure leaves with the draft; the latest one shows. */
export const createCopyFailure = (revisions: Accessor<readonly string[]>) => {
  const failures = createItemFailures<string>(revisions);
  const [latest, setLatest] = createSignal<string | null>(null);

  const failure = (): string | undefined => {
    const revision = latest();

    return revision === null ? undefined : failures.failure(revision);
  };

  return {
    failure,
    fail: (revision: string, message: string): void => { failures.fail(revision, message); setLatest(revision); },
    clear: failures.clear,
    dismiss: (): void => {
      const revision = latest();

      if (revision !== null) failures.clear(revision);
      setLatest(null);
    },
  };
};

/**
 * P3557c: the one failure the Bubbles show. A Terminal's is keyed `${id}:${incarnation}` and leaves with it,
 * except while the Daemon has exited (`present` answers `"unknown"`); one with no Terminal stays until dismissed.
 */
export const createBubbleFailure = (present: Accessor<readonly BubbleTerminal[] | "unknown">) => {
  const failures = createItemFailures<string>(() => {
    const terminals = present();

    return terminals === "unknown" ? terminals : terminals.map(keyOf);
  });

  const [general, setGeneral] = createSignal<string | null>(null);
  const [failed, setFailed] = createSignal<BubbleTerminal | null>(null);

  const failure = (): BubbleFailure | null => {
    const message = general();

    if (message !== null) return { message, terminal: null };
    const terminal = failed();
    const cause = terminal === null ? undefined : failures.failure(keyOf(terminal));

    return terminal === null || cause === undefined ? null : { message: cause, terminal };
  };

  const set = (value: BubbleFailure | null): void => {
    batch(() => {
      const prior = failed();

      if (prior !== null) failures.clear(keyOf(prior));
      setGeneral(value !== null && value.terminal === null ? value.message : null);
      setFailed(value?.terminal ?? null);

      if (value?.terminal) failures.fail(keyOf(value.terminal), value.message);
    });
  };

  return { failure, set, clearGeneral: (): void => { setGeneral(null); }, clearTerminal: (terminal: BubbleTerminal): void => failures.clear(keyOf(terminal)) };
};

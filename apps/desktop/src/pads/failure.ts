import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

/** A failure whose recovery differs from the generic one carries its kind; the kind, never the message text, picks the action. */
export type FailureKind = "source-mapping";

export type Failure = {
  message: Accessor<string | null>;
  kind: Accessor<FailureKind | undefined>;
  clear(): void;
  show(message: string, kind?: FailureKind): void;
  /** Clears the last failure, runs `work`, and keeps the message of an Error it throws; anything else is rethrown. */
  run(work: () => Promise<void>): Promise<void>;
};

export const createFailure = (): Failure => {
  const [shown, setShown] = createSignal<{ message: string; kind?: FailureKind | undefined } | null>(null);

  return {
    message: () => shown()?.message ?? null,
    kind: () => shown()?.kind,
    clear: () => setShown(null),
    show: (message, kind) => setShown({ message, kind }),
    run: async (work) => {
      setShown(null);

      try {
        await work();
      } catch (thrown) {
        if (!(thrown instanceof Error)) throw thrown;

        setShown({ message: thrown.message });
      }
    },
  };
};

import { retryRead } from "../app/seam";
import { copy as appCopy } from "./copy";
import type { Emulator, EmulatorFactory, TerminalPreparation } from "./emulator";

/** One try of `prepare`: the preparation, or the reason it stopped for good (cancelled, out of time, or no renderer), which no retry changes. */
type Preparing = { kind: "prepared"; value: TerminalPreparation } | { kind: "stopped"; reason: unknown };

type Deps = {
  createEmulator: EmulatorFactory;
  copy: (id: string, text: string) => Promise<void>;
  /** Adopts a prepared emulator as the Terminal's. */
  adopt: (id: string, emulator: Emulator) => void;
};

export const createPrepare = ({ createEmulator, copy, adopt }: Deps) => async (host: HTMLElement, settled = () => true, signal?: AbortSignal): Promise<TerminalPreparation> => {
  // Include lazy loading, fonts and layout in the same finite preparation budget, across every try.
  const deadline = AbortSignal.timeout(5_000);
  const cancellation = AbortSignal.any(signal ? [signal, deadline] : [deadline]);
  const asError = (reason: { message: string }): Error => reason instanceof Error ? reason : new Error(reason.message, { cause: reason }); // callers branch on `instanceof Error`
  const stopped = () => ({ kind: "stopped", reason: deadline.aborted ? new Error(appCopy.terminalDestinationUnavailable) : asError(cancellation.reason) }) as const;

  const waiting = new AbortController();

  // A cancellation answers at once, not after the wait between two tries.
  const gone = new Promise<never>((_, reject) => {
    const abort = () => reject(stopped().reason);

    if (cancellation.aborted) abort();
    else cancellation.addEventListener("abort", abort, { once: true, signal: waiting.signal });
  });

  // U6249b: attaching is local and cheap to repeat, so a try that fails quickly is made again by the read retry.
  const attempts = retryRead(async (): Promise<Preparing> => {
    if (cancellation.aborted) return stopped();

    let bound: string | null = null;
    const emulator = createEmulator(crypto.randomUUID(), text => bound ? copy(bound, text) : Promise.resolve());
    let owned = true;
    const dispose = () => { if (owned) { owned = false; emulator.dispose(); } };

    try {
      if (!emulator.prepare) {
        dispose();

        return { kind: "stopped", reason: new Error(appCopy.terminalPreparationUnavailable) };
      }

      const size = await Promise.race([emulator.prepare(host, settled, cancellation), gone]);

      return { kind: "prepared", value: { size, bind: id => {
        if (!owned) return;
        bound = id;
        emulator.bind?.(id);
        adopt(id, emulator);
        owned = false;
      }, dispose } };
    } catch (error) {
      dispose();

      if (cancellation.aborted) return stopped();

      throw error;
    }
  });

  const preparing = await Promise.race([attempts, gone]).catch((error) => {
    // A try that finishes after the answer has no owner.
    void attempts.then(late => { if (late.kind === "prepared") late.value.dispose(); }, () => {});

    throw error;
  }).finally(() => waiting.abort());

  if (preparing.kind === "stopped") throw preparing.reason;

  return preparing.value;
};

import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { applying } from "./pending";

/** What a command shows: nothing, a call in flight, or why the last call failed. */
export type CommandState = { kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string };

/** `failed` is a refusal or a call with no answer (the Daemon may still apply it); `aborted` is an `AbortError`, shown as nothing. */
export type Ran<T> =
  | { kind: "applied"; value: T }
  | { kind: "failed"; error: Error; outcome: "failed" | "unknown" }
  | { kind: "aborted"; error: Error };

export type Command<A extends unknown[], T> = ((...args: A) => Promise<Ran<T>>) & { state: Accessor<CommandState> };

export type CommandOptions = {
  /** Called with each failure's message, after the state is set. */
  fail?: (message: string, error: Error) => void;
  /** Rethrows the Error after the failure is set, for a caller that settles its own result. */
  rethrow?: boolean;
};

/** A command the UI shows as pending or failed, declared once: it owns the catch around the Daemon call. A non-Error rethrows, an `AbortError` stays silent, and a failure is classified by `applying` (U5172a, U3791b). */
export const command = <A extends unknown[], T>(run: (...args: A) => Promise<T>, { fail, rethrow = false }: CommandOptions = {}): Command<A, T> => {
  const [state, setState] = createSignal<CommandState>({ kind: "idle" });
  let inflight = 0;

  const call = async (...args: A): Promise<Ran<T>> => {
    inflight++;
    setState({ kind: "pending" });

    try {
      const result = await applying(() => run(...args));

      if (result.kind === "applied") {
        setState({ kind: "idle" });

        return result;
      }

      if (!(result.thrown instanceof Error)) throw result.thrown;

      if (result.thrown.name === "AbortError") {
        setState({ kind: "idle" });

        return { kind: "aborted", error: result.error };
      }

      setState({ kind: "failed", message: result.error.message });
      fail?.(result.error.message, result.error);

      if (rethrow) throw result.thrown;

      return { kind: "failed", error: result.error, outcome: result.kind === "refused" ? "failed" : "unknown" };
    } finally {
      inflight--;

      if (inflight > 0) setState({ kind: "pending" });
    }
  };

  return Object.assign(call, { state });
};

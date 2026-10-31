import { outcomeOf } from "./seam";

/** U5172a: how a change to Daemon state ended. `refused` is a known no; `pending` is no answer, so the Daemon may still apply it. */
export type Applied<T> = { kind: "applied"; value: T } | { kind: "refused"; error: Error; thrown: unknown } | { kind: "pending"; error: Error; thrown: unknown };

/** U5172a: the one place a mutating call is classified with `outcomeOf` (U3791b). */
export const applying = async <T>(call: () => Promise<T>): Promise<Applied<T>> => {
  try {
    return { kind: "applied", value: await call() };
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));

    return { kind: outcomeOf(thrown) === "failed" ? "refused" : "pending", error, thrown };
  }
};

/** U5172a: the value of an applied call; a refusal or pending outcome rethrows for a caller that settles its own draft with `outcomeOf`. */
export const applied = async <T>(call: () => Promise<T>): Promise<T> => {
  const result = await applying(call);

  if (result.kind === "applied") return result.value;
  throw result.thrown;
};

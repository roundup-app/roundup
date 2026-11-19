import type { Event } from "@contracts/Event";
import { copy } from "./copy";
import { INTERNAL_CODE, outcomeOf, RpcError } from "./seam";

const MISSING_CORE = /herdr-core is not installed\..*$/s;

/** The message of a failed call, or `null` when it succeeded. Anything that is not an Error is a bug and escapes. */
export const failureOf = async <Result>(call: () => Promise<Result>): Promise<string | null> => {
  try {
    await call();

    return null;
  } catch (failure) {
    if (!(failure instanceof Error)) throw failure;

    return failure.message;
  }
};

/** A committed change or removal ends failures about this Todo, never a list read or retention problem. */
export const doesClearTodoFailure = (event: Event, id: number): boolean =>
  (event.name === "todo.restored" || event.name === "todo.updated" || event.name === "todo.deleted" || event.name === "todo.commented" || event.name === "todo.refAdded" || event.name === "todo.refRemoved") && event.data.id === id;

/** U5172a: the message of a refused change, or `null` when it applied or is still pending; the Daemon's event or a re-read settles a pending one. Classified like `applying`, with no extra await so the caller resumes as `failureOf` did. */
export const changeFailureOf = async <Result>(call: () => Promise<Result>): Promise<string | null> => {
  try {
    await call();

    return null;
  } catch (thrown) {
    return outcomeOf(thrown) === "failed" && thrown instanceof Error ? thrown.message : null;
  }
};

/** U7498c: what a call with no answer says, from the copy table by code: completion is unconfirmed, never a failure and never an invitation to repeat it. */
export const unknownOutcomeLine = (error: Error): string => {
  if (!(error instanceof RpcError)) return copy.rpcFailure(0);

  // HM7589a: the one internal failure whose cause the user can fix says so; any other keeps the fixed copy (HM7589b).
  const named = error.code === INTERNAL_CODE ? MISSING_CORE.exec(error.message) : null;

  return named === null ? copy.rpcFailure(error.code) : named[0];
};

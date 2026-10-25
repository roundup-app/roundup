import type { Event } from "@contracts/Event";

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

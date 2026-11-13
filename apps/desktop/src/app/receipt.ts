import { applied } from "./pending";

/** U5170c: a keyed change confirmed once. The first read never drops: a lost acknowledgement may already have applied it, and a failed apply re-reads before it reports. */
export const confirmed = async <R>(read: () => Promise<R | null> | null, apply: () => Promise<R>, done: (receipt: R) => boolean) => {
  // A read that has nothing to ask returns `null` at once, so a first call reaches the Daemon in the same tick.
  const asking = read();
  const before = asking && await asking;

  if (before && done(before)) return before;

  try { return await applied(apply); }
  catch (error) {
    const after = await read();

    if (after && done(after)) return after;
    throw error;
  }
};

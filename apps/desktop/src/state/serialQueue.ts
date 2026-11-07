/** Runs jobs one at a time in the order added; each job starts in the same tick as `add` when the queue is idle. */
export const createSerialQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let waiting: (() => void)[] = [];

  const settle = () => {
    if (--pending > 0) return;
    const done = waiting;

    waiting = [];

    for (const resolve of done) resolve();
  };

  return {
    add: <T>(job: () => Promise<T> | T): Promise<T> => {
      const run = pending === 0 ? new Promise<T>(resolve => { resolve(job()); }) : tail.then(job);

      pending++;
      tail = run.then(settle, settle);

      return run;
    },
    busy: () => pending > 0,
    idle: (): Promise<void> => pending === 0 ? Promise.resolve() : new Promise(resolve => { waiting.push(resolve); }),
  };
};
